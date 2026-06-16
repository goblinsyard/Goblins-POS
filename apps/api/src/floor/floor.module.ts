import { Module } from '@nestjs/common';
import { FloorController } from './floor.controller';

@Module({ controllers: [FloorController] })
export class FloorModule {}
