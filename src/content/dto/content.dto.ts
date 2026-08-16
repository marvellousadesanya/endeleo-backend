import {
  ArrayMaxSize, IsArray, IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength,
} from "class-validator";

export class SubmitApplicationDto {
  @IsString() @Length(2, 120) fullName!: string;
  @IsEmail() @MaxLength(255) email!: string;

  @IsOptional() @IsEnum(["retail", "institutional"]) investorType?: "retail" | "institutional";
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(40) ticketRange?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) sectors?: string[];
  @IsOptional() @IsString() @MaxLength(120) heardFrom?: string;

  @IsOptional() @IsString() @MaxLength(160) firm?: string;
  @IsOptional() @IsString() @MaxLength(120) role?: string;
  @IsOptional() @IsString() @MaxLength(80) organizationType?: string;
  @IsOptional() @IsString() @MaxLength(80) timeline?: string;
  @IsOptional() @IsString() @MaxLength(300) linkedinUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  // Attribution, captured by the marketing site.
  @IsOptional() @IsString() @MaxLength(120) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(120) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(120) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(500) referrer?: string;
  @IsOptional() @IsString() @MaxLength(500) landingPath?: string;
}
