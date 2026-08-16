import { Transform } from "class-transformer";
import {
  IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
} from "class-validator";

/** Multipart sends everything as strings, so numeric fields need coercing. */
const toInt = () => Transform(({ value }) =>
  value === undefined || value === "" ? undefined : Number(value));

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
}
