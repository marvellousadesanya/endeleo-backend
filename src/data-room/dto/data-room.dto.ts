import { Transform } from "class-transformer";
import {
  IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min,
} from "class-validator";

/** Multipart fields arrive as strings, so booleans and ints need coercing. */
const toBool = () => Transform(({ value }) => value === true || value === "true");
const toInt = () => Transform(({ value }) => (value === undefined ? undefined : Number(value)));

export class UpsertDocumentDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() bondId?: string;

  @IsString() @Length(2, 200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(160) issuer?: string;

  @IsOptional() @toBool() @IsBoolean() requiresSignature?: boolean;
  @IsOptional() @toBool() @IsBoolean() isPublished?: boolean;
  @IsOptional() @toInt() @IsInt() @Min(0) sortOrder?: number;
}

export class SignDocumentDto {
  @IsUUID() documentId!: string;
  @IsString() @Length(2, 120) signedName!: string;
}
