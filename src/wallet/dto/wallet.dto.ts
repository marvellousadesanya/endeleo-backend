import { IsOptional, IsString, Length, Matches } from "class-validator";

/** Money crosses the API as a whole number of minor units in a string. */
const MINOR = /^\d{1,19}$/;

export class TransferDto {
  @Matches(MINOR, { message: "amountMinor must be a whole number of minor units, as a string" })
  amountMinor!: string;

  @IsString() @Length(2, 40) method!: string;

  @IsOptional() @IsString() @Length(0, 120) reference?: string;
}

export class WithdrawDto extends TransferDto {
  @IsString() @Length(2, 120) destination!: string;
}
