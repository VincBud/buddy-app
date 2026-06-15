export type ConversationStatus = 'active' | 'closed' | 'blocked';

export type Conversation = {
  id: string;
  jobId: string;
  creatorId: string;
  buddyId: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
};

export type MessageType = 'text' | 'image' | 'system';

export type MessageSenderRole = 'creator' | 'buddy' | 'system';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: MessageSenderRole;
  type: MessageType;
  text?: string;
  imageUri?: string;
  createdAt: string;
  readAt?: string;
};

export const conversationId = (jobId: string): string => `conv_${jobId}`;
