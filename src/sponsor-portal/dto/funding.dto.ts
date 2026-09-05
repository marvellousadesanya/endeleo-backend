import {
  IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength,
} from "class-validator";

const STATUSES = ["pending", "due", "released"] as const;

export class CreateMilestoneDto {
  @IsUUID() bondId!: string;
  @IsString() @Length(2, 160) label!: string;
  @Matches(/^\d{1,19}$/, { message: "targetMinor must be minor units as a string" })
  targetMinor!: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateMilestoneDto {
  @IsOptional() @IsString() @Length(2, 160) label?: string;
  @IsOptional() @Matches(/^\d{1,19}$/, { message: "targetMinor must be minor units as a string" })
  targetMinor?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
