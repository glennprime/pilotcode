// SDK message types — simplified from happy-cli/src/claude/sdk/types.ts

export interface SDKSystemMessage {
  type: 'system';
  subtype: string;
  session_id?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
}

export interface SDKUserMessage {
  type: 'user';
  parent_tool_use_id?: string;
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
}

export interface SDKAssistantMessage {
  type: 'assistant';
  parent_tool_use_id?: string;
  message: {
    role: 'assistant';
    content: ContentBlock[];
  };
}

export interface SDKResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  result?: string;
  num_turns: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  session_id: string;
}

export interface SDKLogMessage {
  type: 'log';
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
  };
}

export interface CanUseToolControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'can_use_tool';
    tool_name: string;
    input: unknown;
  };
}

export interface ControlCancelRequest {
  type: 'control_cancel_request';
  request_id: string;
}

export interface SDKControlResponse {
  type: 'control_response';
  response: {
    request_id: string;
    subtype: 'success' | 'error';
    error?: string;
  };
}

export type SDKMessage =
  | SDKSystemMessage
  | SDKUserMessage
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKLogMessage
  | CanUseToolControlRequest
  | ControlCancelRequest
  | SDKControlResponse;

// Content blocks used in messages
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

// Input messages we write to Claude's stdin
export interface UserInputMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
}

export interface ControlRequestInput {
  request_id: string;
  type: 'control_request';
  request: {
    subtype: 'interrupt';
  };
}

export interface PermissionResponseInput {
  type: 'control_response';
  response: {
    subtype: 'success' | 'error';
    request_id: string;
    response?: {
      behavior: 'allow' | 'deny';
      updatedInput?: Record<string, unknown>;
      message?: string;
    };
    error?: string;
  };
}

export type StdinMessage = UserInputMessage | ControlRequestInput | PermissionResponseInput;
