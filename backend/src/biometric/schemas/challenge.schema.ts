import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * MongoDB document representing a one-time authentication challenge.
 *
 * Challenges are cryptographically random nonces that must be signed
 * by the device's private key. They expire after a configurable timeout.
 */
@Schema({ timestamps: true })
export class Challenge extends Document {
  @Prop({ required: true, unique: true })
  nonce: string;

  @Prop({ required: true })
  publicKey: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: false })
  isUsed: boolean;
}

export type ChallengeDocument = Challenge & Document;
export const ChallengeSchema = SchemaFactory.createForClass(Challenge);

// Auto-expire challenges after the expiresAt time
ChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
