export interface ImageAttachment {
  dataUrl: string;
  name: string;
}

export interface ParsedContent {
  text: string;
  imageUrl?: string;
}

export function parseMessageContent(content: string): ParsedContent {
  if (content.startsWith('{"__type":"image_msg"')) {
    try {
      const parsed = JSON.parse(content) as { __type: string; text?: string; image?: string };
      if (parsed.__type === "image_msg") {
        return { text: parsed.text ?? "", imageUrl: parsed.image };
      }
    } catch {
      // fall through
    }
  }
  return { text: content };
}
