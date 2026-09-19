import { Transform } from "class-transformer";
import {
  IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
} from "class-validator";

/** Multipart sends everything as strings, so numeric fields need coercing. */
const toInt = () => Transform(({ value }) =>
  value === undefined || value === "" ? undefined : Number(value));

/** Multipart sends booleans as the strings "true"/"false". */
const toBool = () => Transform(({ value }) =>
  value === undefined || value === "" ? undefined : value === true || value === "true");

export class CreateSubmissionDto {
  @IsString() @Length(2, 120) submitterName!: string;
  @IsEmail() @MaxLength(255) submitterEmail!: string;
  @IsOptional() @IsString() @MaxLength(40) submitterPhone?: string;
  @IsOptional() @IsString() @MaxLength(160) organization?: string;
  @IsOptional() @IsString() @MaxLength(120) role?: string;

  @IsEnum(["individual", "government", "corporate"], {
    message: "Sponsor profile must be Individual, Government, or Corporate",
  })
  submitterType!: "individual" | "government" | "corporate";

  @IsString() @Length(3, 160) projectTitle!: string;
  @IsString() @Length(2, 60) sector!: string;
  @IsOptional() @IsString() @MaxLength(80) locationState?: string;
  @IsOptional() @IsString() @MaxLength(60) projectStage?: string;

  @IsOptional() @Matches(/^\d{1,19}$/, { message: "capitalRequiredMinor must be minor units as a string" })
  capitalRequiredMinor?: string;

  /** Basis points — 1250 = 12.5%. */
  @IsOptional() @toInt() @IsInt() @Min(0) @Max(10_000) expectedReturnBps?: number;
  @IsOptional() @toInt() @IsInt() @Min(0) @Max(600) tenorMonths?: number;

  @IsString() @Length(30, 4000) summary!: string;
  @IsOptional() @IsString() @MaxLength(255) websiteUrl?: string;
  /** JSON array of { label, url }, sent as a string by the multipart form. */
  @IsOptional() @IsString() @MaxLength(4000) additionalLinks?: string;

  // ---- M2 self-assessment — feeds the DSCR calculation and bankability scorecard --

  @IsOptional() @IsEnum(["tariff", "offtake", "government_payment", "user_fee", "other"])
  revenueModel?: "tariff" | "offtake" | "government_payment" | "user_fee" | "other";

  @IsOptional() @toBool() @IsBoolean() offtakeAgreementInPlace?: boolean;
  @IsOptional() @toBool() @IsBoolean() priorDfiFunding?: boolean;
  @IsOptional() @toBool() @IsBoolean() ongoingLitigation?: boolean;
  @IsOptional() @toBool() @IsBoolean() priorDefault?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) useOfProceedsDetail?: string;

  /**
   * JSON array of { year, revenueMinor, opexMinor }, sent as a string by the
   * multipart form — same convention as additionalLinks. Structural validation
   * happens in the service, not here, because a malformed entry should fail with a
   * message pointing at which year is wrong.
   */
  @IsOptional() @IsString() @MaxLength(8000) cashflows?: string;
}

/** Moves a submission through review. Promoting it is a separate, dedicated step. */
export class ReviewSubmissionDto {
  @IsEnum(["in_review", "approved", "rejected"], {
    message: "status must be in_review, approved, or rejected",
  })
  status!: "in_review" | "approved" | "rejected";

  @IsOptional() @IsString() @MaxLength(4000) reviewerNotes?: string;
}

/**
 * Creates the investor-facing bond from an approved submission. Only the fields a
 * sponsor never provides — everything the bond engine and the register need but the
 * intake form has no business asking for. Money crosses as a string; see CreateBondDto.
 */
export class PromoteSubmissionDto {
  @IsString() issuerId!: string;
  @IsString() @Length(2, 80) spvReference!: string;

  /** Defaults to the submission's own figure when omitted. */
  @IsOptional() @Matches(/^\d{1,19}$/, { message: "totalSizeMinor must be minor units as a string" })
  totalSizeMinor?: string;

  @Matches(/^\d{1,19}$/, { message: "minimumInvestmentMinor must be minor units as a string" })
  minimumInvestmentMinor!: string;

  @IsOptional() @toInt() @IsInt() @Min(1) @Max(360) tenorMonths?: number;
  @IsOptional() @toInt() @IsInt() @Min(0) @Max(5000) couponRateBps?: number;

  @IsOptional() @IsEnum(["monthly", "quarterly", "semiannual", "annual", "zero"])
  couponFrequency?: "monthly" | "quarterly" | "semiannual" | "annual" | "zero";

  @IsString() subscriptionOpenAt!: string;
  @IsString() subscriptionCloseAt!: string;
}
