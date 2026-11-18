export interface CharakuruStudioConfig {
  port?: number;
  allowCloudExecution?: boolean;
  autoStart?: boolean;
  blenderPluginUrl?: string;
  comfyuiUrl?: string;
  comfyuiQwenWorkflowPath?: string;
  qwenImageUrl?: string;
  openaiCompatBaseUrl?: string;
  defaultImageModel?: string;
  tripoMonthlyFreeCredits?: number;
}

export declare const name: 'dsh-charakuru-studio';
export declare const inject: string[];
export declare const Config: unknown;
export declare function apply(ctx: unknown, config?: CharakuruStudioConfig): void;
export declare const __internals: Record<string, unknown>;
