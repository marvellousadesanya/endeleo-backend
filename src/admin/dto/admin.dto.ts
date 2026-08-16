import {
  IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength,
} from "class-validator";

export class UpsertPostDto {
  @Matches(/^[a-z0-9-]+$/, { message: "slug must be lowercase letters, numbers and hyphens" })
  @Length(2, 80)
  slug!: string;

  @IsString() @Length(2, 160) title!: string;
  @IsOptional() @IsString() @MaxLength(400) excerpt?: string;
  @IsOptional() @IsString() @MaxLength(60_000) body?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @IsString() @MaxLength(500) coverUrl?: string;
  @IsEnum(["draft", "published"]) status!: "draft" | "published";
}

export class CreateProjectUpdateDto {
  @IsString() @Length(1, 64) projectSlug!: string;
  @IsString() @Length(2, 160) title!: string;
  @IsOptional() @IsString() @MaxLength(20_000) body?: string;
}

export class SetUserRoleDto {
  @IsUUID() userId!: string;
  @IsEnum(["admin", "editor", "issuer", "investor"])
  role!: "admin" | "editor" | "issuer" | "investor";
  @IsBoolean() grant!: boolean;
}
