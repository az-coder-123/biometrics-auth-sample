import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * MongoDB document representing a registered user.
 *
 * Stores authentication credentials and profile information.
 */
@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ default: true })
  isActive: boolean;
}

export type UserDocument = User & Document;
export const UserSchema = SchemaFactory.createForClass(User);
