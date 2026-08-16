import { IsInt, IsString, Length, Matches, Max, Min } from "class-validator";

const MINOR = /^\d{1,19}$/;

export class CreateInvestmentDto {
  @IsString() @Length(1, 64) projectSlug!: string;

  @Matches(MINOR, { message: "amountMinor must be a whole number of minor units, as a string" })
  amountMinor!: string;

  /** Basis points, not a float percentage — 1250 = 12.5%. */
  @IsInt() @Min(0) @Max(5000) ratePctBps!: number;

  @IsInt() @Min(1) @Max(360) tenorMonths!: number;
}
