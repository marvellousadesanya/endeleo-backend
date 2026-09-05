import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, MaxLength } from "class-validator";

const toInt = () => Transform(({ value }) => (value === undefined ? undefined : Number(value)));

const KINDS = ["compliance", "due_diligence"] as const;
const SPONSOR_STATUSES = ["in_progress", "submitted"] as const;
const ADMIN_STATUSES = ["not_started", "in_progress", "submitted", "verified", "rejected"] as const;

export class CreateChecklistItemDto {
  @IsUUID() bondId!: string;
  @IsIn(KINDS) kind!: (typeof KINDS)[number];
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsString() @Length(2, 200) label!: string;
  @IsOptional() @toInt() @IsInt() @Min(0) sortOrder?: number;
}

/** What a sponsor may set on their own item — forward progress only. */
export class SponsorUpdateChecklistItemDto {
  @IsOptional() @IsIn(SPONSOR_STATUSES) status?: (typeof SPONSOR_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/** Admin can additionally verify, reject, or reset. */
export class AdminUpdateChecklistItemDto {
  @IsOptional() @IsIn(ADMIN_STATUSES) status?: (typeof ADMIN_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @Length(2, 200) label?: string;
  @IsOptional() @IsString() @MaxLength(80) area?: string;
}
