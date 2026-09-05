import { IsString, Length, Matches } from "class-validator";

/** Money crosses the API as a whole number of minor units in a string. */
const MINOR = /^\d{1,19}$/;

export class InitializePaystackDepositDto {
  @Matches(MINOR, { message: "amountMinor must be a whole number of minor units, as a string" })
  amountMinor!: string;
}

/** NUBAN — the standard 10-digit Nigerian bank account number. */
const NUBAN = /^\d{10}$/;

export class ResolveBankAccountDto {
  @Matches(NUBAN, { message: "accountNumber must be a 10-digit NUBAN" })
  accountNumber!: string;

  @IsString() @Length(1, 10) bankCode!: string;
}

export class InitiatePaystackWithdrawalDto {
  @Matches(MINOR, { message: "amountMinor must be a whole number of minor units, as a string" })
  amountMinor!: string;

  @Matches(NUBAN, { message: "accountNumber must be a 10-digit NUBAN" })
  accountNumber!: string;

  @IsString() @Length(1, 10) bankCode!: string;
}
