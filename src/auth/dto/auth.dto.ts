import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "A valid email is required" })
  @MaxLength(254)
  email!: string;

  // 12 is a deliberate floor for a financial account; length beats complexity rules.
  @IsString()
  @MinLength(12, { message: "Password must be at least 12 characters" })
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  fullName?: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(500)
  refreshToken!: string;
}
