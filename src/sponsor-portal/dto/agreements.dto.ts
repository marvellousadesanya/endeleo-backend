import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, MaxLength } from "class-validator";

const toInt = () => Transform(({ value }) => (value === undefined ? undefined : Number(value)));
const STATUSES = ["draft", "sent", "signed"] as const;

export class UpsertAgreementDto {
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() bondId!: string;
  @IsString() @Length(2, 200) title!: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @toInt() @IsInt() @Min(0) sortOrder?: number;
}

export class SignAgreementDto {
  @IsUUID() id!: string;
  @IsString() @Length(2, 120) signedName!: string;
}
