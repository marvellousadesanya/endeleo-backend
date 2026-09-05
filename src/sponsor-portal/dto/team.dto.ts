import { IsEmail, IsIn, MaxLength } from "class-validator";

const ROLES = ["editor", "viewer"] as const;

export class InviteTeamMemberDto {
  @IsEmail() @MaxLength(255) email!: string;
  @IsIn(ROLES) role!: (typeof ROLES)[number];
}

export class UpdateTeamMemberDto {
  @IsIn(ROLES) role!: (typeof ROLES)[number];
}
