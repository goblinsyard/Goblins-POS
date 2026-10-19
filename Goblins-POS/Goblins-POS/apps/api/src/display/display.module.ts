import { Module } from '@nestjs/common';
import { DisplayController } from './display.controller';

@Module({ controllers: [DisplayController] })
export class DisplayModule {}
