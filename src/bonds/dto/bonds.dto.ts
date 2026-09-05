import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsDateString, IsEnum, IsInt, IsISO8601, IsOptional,
  IsString, IsUUID, Length, Max, MaxLength, Min,
} from "class-validator";

/**
 * Money crosses the API as a string, not a number.
 * JSON numbers are IEEE doubles and silently lose precision past 2^53; a bond size in
 * kobo passes that at around ₦90 billion. Strings are converted to BigInt server-side.
 */
const MONEY = /^\d{1,19}$/;

export class CreateBondDto {
  @IsString() @Length(3, 160) title!: string;
  @IsString() @Length(2, 80) spvReference!: string;
  @IsOptional() @IsString() @Length(1, 64) projectSlug?: string;

  @IsOptional() @IsEnum(["NGN", "USD", "GBP", "EUR"]) currency?: "NGN" | "USD" | "GBP" | "EUR";

  @IsString() totalSizeMinor!: string;
  @IsString() minimumInvestmentMinor!: string;

  @IsInt() @Min(1) @Max(360) tenorMonths!: number;
  @IsInt() @Min(0) @Max(5000) couponRateBps!: number;

  @IsOptional() @IsEnum(["monthly", "quarterly", "semiannual", "annual", "zero"])
  couponFrequency?: "monthly" | "quarterly" | "semiannual" | "annual" | "zero";

  @IsOptional() @IsEnum(["fcfs", "pro_rata", "waitlist"])
  allocationRule?: "fcfs" | "pro_rata" | "waitlist";

  @IsOptional() @IsInt() @Min(1) @Max(10000) concentrationLimitBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3) kycTierRequired?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) geoBlock?: string[];

  @IsISO8601() subscriptionOpenAt!: string;
  @IsISO8601() subscriptionCloseAt!: string;

  /** Optional. Left unset, both are derived at activation. */
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() maturityDate?: string;

  // ---- Investor-facing project content ----------------------------------------
  // All optional. A bond with none of it falls back to the frontend fixture by slug.
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsString() @MaxLength(120) sector?: string;
  @IsOptional() @IsString() @MaxLength(280) summary?: string;
  @IsOptional() @IsString() @MaxLength(5000) overview?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(240, { each: true })
  highlights?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(240, { each: true })
  risks?: string[];
}

export class ChangeStatusDto {
  @IsEnum(["open", "subscribed", "active", "matured", "closed", "defaulted"])
  status!: "open" | "subscribed" | "active" | "matured" | "closed" | "defaulted";
}

export class SubscribeDto {
  @IsUUID() bondId!: string;
  @IsString() amountMinor!: string;
}

export class CreateListingDto {
  @IsUUID() bondId!: string;
  @IsString() unitsMinor!: string;
  /** Basis points of par. 10000 = at par. */
  @IsInt() @Min(1) @Max(20000) askPriceBps!: number;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class BuyDto {
  @IsUUID() listingId!: string;
  @IsString() unitsMinor!: string;
}

export class RecordEscrowDto {
  @IsUUID() bondId!: string;
  @IsEnum(["coupon", "principal", "default_reserve"]) purpose!: "coupon" | "principal" | "default_reserve";
  @IsString() amountMinor!: string;
}

export class AdvanceEngineDto {
  @IsDateString() asOf!: string;
}

export class SimulateDto {
  @IsUUID() bondId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) maxSteps?: number;
}

/** Parse a money string into BigInt, rejecting anything that is not a whole amount. */
export function toMinor(value: string, field: string): bigint {
  if (!MONEY.test(value)) {
    throw new Error(`${field} must be a whole number of minor units, given as a string`);
  }
  return BigInt(value);
}
