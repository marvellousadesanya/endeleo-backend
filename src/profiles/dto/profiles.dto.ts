import {
  IsEnum, IsISO8601, IsObject, IsOptional, IsString, Length,
} from "class-validator";

export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 120) fullName?: string;
  @IsOptional() @IsEnum(["USD", "NGN", "GBP", "EUR"]) currencyPref?: "USD" | "NGN" | "GBP" | "EUR";
  @IsOptional() @IsString() @Length(1, 40) phone?: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() @Length(1, 240) address?: string;
  @IsOptional() @IsString() @Length(1, 512) avatarUrl?: string;

  /** Set once the sponsor picks a profile on the project-submission form. */
  @IsOptional() @IsEnum(["individual", "government", "corporate"])
  submitterType?: "individual" | "government" | "corporate";
}

/**
 * KYC submission. The two investor types need different fields, so everything past
 * `investorType` is optional here and the required set is enforced in the service —
 * class-validator has no clean way to express "required only when institutional".
 */
export class SubmitKycDto {
  @IsEnum(["retail", "institutional"]) investorType!: "retail" | "institutional";

  @IsOptional() @IsString() @Length(2, 120) fullName?: string;
  @IsOptional() @IsISO8601() dateOfBirth?: string;
  @IsOptional() @IsString() @Length(2, 80) nationalId?: string;
  @IsOptional() @IsString() @Length(2, 80) taxId?: string;
  @IsOptional() @IsString() @Length(2, 160) companyName?: string;
  @IsOptional() @IsString() @Length(2, 80) registrationNumber?: string;
  @IsOptional() @IsString() @Length(2, 80) contactTitle?: string;
  @IsOptional() @IsString() @Length(5, 240) address?: string;

  /** Map of document key → storage path. Paths only; files are uploaded separately. */
  @IsObject() documents!: Record<string, string>;
}
