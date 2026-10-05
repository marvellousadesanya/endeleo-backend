// Nigerian macro context, from the World Bank's open indicators API.
//
// Free, no key, no registration — which is the whole reason it is here. It gives the
// screen something real to sit against: a 21% coupon reads very differently at 23%
// inflation than at 8%, and the FX panel in M2 had nothing in it at all.
//
// What this is NOT is a benchmark. The series are *annual*, and the API carries no bond
// yields or policy rate, so it cannot replace ARRANGEMENT_BENCHMARK_BPS — that still wants
// a daily FGN yield from DMO, CBN or a commercial feed. Saying so on the panel matters
// more than quietly substituting a number that would look authoritative and be wrong.
import { Injectable, Logger } from "@nestjs/common";

/** One year's reading of one series. */
export interface MacroPoint {
  year: number;
  value: number;
}

export interface NigeriaMacro {
  /** Consumer price inflation, annual %. */
  inflation: MacroPoint[];
  /** Official exchange rate, naira per US dollar, period average. */
  fx: MacroPoint[];
  /** GDP growth, annual %. */
  gdpGrowth: MacroPoint[];
  /** When this was fetched, so a stale panel can say so. */
  fetchedAt: string;
  source: string;
}

const SERIES = {
  inflation: "FP.CPI.TOTL.ZG",
  fx: "PA.NUS.FCRF",
  gdpGrowth: "NY.GDP.MKTP.KD.ZG",
} as const;

const BASE = "https://api.worldbank.org/v2/country/NGA/indicator";
/**
 * The data is annual, so this only has to be short enough that a new release is picked
 * up within a day of someone looking. Anything shorter is spending requests on a number
 * that changes once a year.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Long enough for a cold API, short enough not to hold up a screen that can do without. */
const FETCH_TIMEOUT_MS = 8000;

@Injectable()
export class MacroService {
  private readonly logger = new Logger(MacroService.name);
  private cache: { at: number; data: NigeriaMacro } | null = null;
  /** Shared between concurrent callers so a cold cache causes one fetch, not three. */
  private inFlight: Promise<NigeriaMacro | null> | null = null;

  /**
   * Returns null rather than throwing when the API is unreachable.
   *
   * Every caller already has a complete screen without this; macro context is an
   * addition to it, and a third party being slow must not take the page down.
   */
  async nigeria(): Promise<NigeriaMacro | null> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.data;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchAll()
      .then((data) => {
        if (data) this.cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async fetchAll(): Promise<NigeriaMacro | null> {
    try {
      const [inflation, fx, gdpGrowth] = await Promise.all([
        this.series(SERIES.inflation),
        this.series(SERIES.fx),
        this.series(SERIES.gdpGrowth),
      ]);

      // An empty response is not an outage — but it is also not context, and a panel with
      // nothing in it should say "no data" rather than render empty axes.
      if (inflation.length === 0 && fx.length === 0) return null;

      return {
        inflation,
        fx,
        gdpGrowth,
        fetchedAt: new Date().toISOString(),
        source: "World Bank open data (api.worldbank.org), annual series",
      };
    } catch (err) {
      this.logger.warn(`World Bank macro fetch failed: ${String(err)}`);
      return null;
    }
  }

  /** Newest first, nulls dropped — the API returns a year per row with gaps. */
  private async series(indicator: string): Promise<MacroPoint[]> {
    const url = `${BASE}/${indicator}?format=json&per_page=12&date=2015:${new Date().getUTCFullYear()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${indicator} returned ${res.status}`);

    const body = (await res.json()) as unknown;
    // The shape is [paging, rows] and `rows` is null when the query matched nothing.
    if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) return [];

    return (body[1] as { date: string; value: number | null }[])
      .filter((r) => r.value !== null && Number.isFinite(r.value))
      .map((r) => ({ year: Number(r.date), value: Number(r.value) }))
      .filter((p) => Number.isFinite(p.year))
      .sort((a, b) => b.year - a.year);
  }
}

/**
 * The real return on a coupon, given inflation.
 *
 * Fisher, not the subtraction people reach for: at Nigerian inflation the two diverge by
 * enough to matter. A 21% coupon at 23% inflation is −1.6% real, not −2%.
 */
export function realRatePct(couponPct: number, inflationPct: number): number {
  return ((1 + couponPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
