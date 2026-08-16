import { Module } from "@nestjs/common";
import { DataRoomController } from "./data-room.controller";
import { DataRoomService } from "./data-room.service";

@Module({
  controllers: [DataRoomController],
  providers: [DataRoomService],
})
export class DataRoomModule {}
