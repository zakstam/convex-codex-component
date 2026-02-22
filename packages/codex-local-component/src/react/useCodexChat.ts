"use client";

import { useCallback, useMemo, useState } from "react";
import type { FunctionArgs } from "convex/server";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexMessagesQuery, CodexThreadReadResult } from "./types.js";
import {
  useCodexConversationController,
  type CodexConversationControllerConfig,
} from "./useCodexConversationController.js";
import {
  type CodexDynamicToolHandler,
  type CodexDynamicToolsHandlerMap,
  type CodexDynamicToolsQuery,
  type CodexDynamicToolsRespond,
} from "./useCodexDynamicTools.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexSyncHydrationSource } from "./syncHydration.js";

export type CodexChatDynamicToolsConfig<
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
  DynamicToolsRespondResult = unknown,
> = {
  query: DynamicToolsQuery;
  args: FunctionArgs<DynamicToolsQuery> | "skip";
  respond?: CodexDynamicToolsRespond<DynamicToolsRespondResult>;
  handlers?: CodexDynamicToolsHandlerMap;
  autoHandle?: boolean;
  enabled?: boolean;
  disabledTools?: readonly string[];
  handlerOverrides?: CodexDynamicToolsHandlerMap;
};

export type CodexChatConfig<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = Omit<
  CodexConversationControllerConfig<
    MessagesQuery,
    ThreadStateQuery,
    DynamicToolsQuery,
    ComposerResult,
    ApprovalResult,
    InterruptResult,
    DynamicToolsRespondResult
  >,
  "composer" | "dynamicTools"
> & {
  composer?: CodexConversationControllerConfig<
    MessagesQuery,
    ThreadStateQuery,
    DynamicToolsQuery,
    ComposerResult,
    ApprovalResult,
    InterruptResult,
    DynamicToolsRespondResult
  >["composer"];
  dynamicTools?: CodexChatDynamicToolsConfig<DynamicToolsQuery, DynamicToolsRespondResult>;
  syncHydration?: {
    source: CodexSyncHydrationSource;
    conversationId: string | null;
    enabled?: boolean;
  };
};

export type CodexChatTools = {
  disabledTools: readonly string[];
  overrideTools: readonly string[];
  isToolDisabled: (toolName: string) => boolean;
  disableTools: (toolNames: readonly string[]) => void;
  enableTools: (toolNames: readonly string[]) => void;
  overrideToolHandler: (toolName: string, handler: CodexDynamicToolHandler) => void;
  removeToolOverride: (toolName: string) => void;
  clearToolOverrides: () => void;
  setToolOverrides: (handlers: CodexDynamicToolsHandlerMap) => void;
};

type CodexChatResultState<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = ReturnType<
  typeof useCodexConversationController<
    MessagesQuery,
    ThreadStateQuery,
    DynamicToolsQuery,
    ComposerResult,
    ApprovalResult,
    InterruptResult,
    DynamicToolsRespondResult
  >
> & {
  tools: CodexChatTools;
};

export type CodexChatResult<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = CodexChatResultState<
  MessagesQuery,
  ThreadStateQuery,
  DynamicToolsQuery,
  ComposerResult,
  ApprovalResult,
  InterruptResult,
  DynamicToolsRespondResult
>;

export type CodexChatOptions<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>> = CodexDynamicToolsQuery<
    Record<string, unknown>
  >,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = CodexChatConfig<
  MessagesQuery,
  ThreadStateQuery,
  DynamicToolsQuery,
  ComposerResult,
  ApprovalResult,
  InterruptResult,
  DynamicToolsRespondResult
>;

function normalizeToolName(toolName: string): string {
  return toolName.trim();
}

function normalizeToolList(toolNames: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const toolName of toolNames) {
    const name = normalizeToolName(toolName);
    if (name.length > 0) {
      normalized.add(name);
    }
  }
  return [...normalized];
}

export function useCodexChat<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>> = CodexDynamicToolsQuery<
    Record<string, unknown>
  >,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
>(config: CodexChatOptions<
  MessagesQuery,
  ThreadStateQuery,
  DynamicToolsQuery,
  ComposerResult,
  ApprovalResult,
  InterruptResult,
  DynamicToolsRespondResult
>): CodexChatResult<
  MessagesQuery,
  ThreadStateQuery,
  DynamicToolsQuery,
  ComposerResult,
  ApprovalResult,
  InterruptResult,
  DynamicToolsRespondResult
> {
  const [disabledTools, setDisabledTools] = useState<readonly string[]>(() =>
    normalizeToolList(config.dynamicTools?.disabledTools ?? []),
  );
  const [toolOverrides, setToolOverrides] = useState<CodexDynamicToolsHandlerMap>(() => ({
    ...config.dynamicTools?.handlerOverrides,
  }));

  const disableTools = useCallback((toolNames: readonly string[]) => {
    const nextNormalized = normalizeToolList(toolNames);
    if (nextNormalized.length === 0) {
      return;
    }
    setDisabledTools((current) => {
      const next = normalizeToolList([...current, ...nextNormalized]);
      if (
        next.length === current.length &&
        next.every((name, index) => name === current[index])
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const enableTools = useCallback((toolNames: readonly string[]) => {
    const removeSet = new Set(normalizeToolList(toolNames));
    if (removeSet.size === 0) {
      return;
    }
    setDisabledTools((current) => {
      let changed = false;
      const next = current.filter((toolName) => {
        if (removeSet.has(toolName)) {
          changed = true;
          return false;
        }
        return true;
      });
      if (!changed) {
        return current;
      }
      return next;
    });
  }, []);

  const setToolOverridesAction = useCallback((handlers: CodexDynamicToolsHandlerMap) => {
    setToolOverrides(() => ({ ...handlers }));
  }, []);

  const clearToolOverrides = useCallback(() => {
    setToolOverrides({});
  }, []);

  const overrideToolHandler = useCallback((toolName: string, handler: CodexDynamicToolHandler) => {
    const name = normalizeToolName(toolName);
    if (!name) {
      return;
    }
    setToolOverrides((current) => {
      if (current[name] === handler) {
        return current;
      }
      return {
        ...current,
        [name]: handler,
      };
    });
  }, []);

  const removeToolOverride = useCallback((toolName: string) => {
    const name = normalizeToolName(toolName);
    if (!name) {
      return;
    }
    setToolOverrides((current) => {
      if (!Object.hasOwn(current, name)) {
        return current;
      }
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

  const isToolDisabled = useCallback(
    (toolName: string) => {
      const name = normalizeToolName(toolName);
      return name.length > 0 ? disabledTools.includes(name) : false;
    },
    [disabledTools],
  );

  const effectiveHandlers = useMemo(() => {
    const handlers: CodexDynamicToolsHandlerMap = {
      ...(config.dynamicTools?.handlers ?? {}),
      ...toolOverrides,
    };

    if (disabledTools.length === 0) {
      return handlers;
    }

    const disabled = new Set(
      disabledTools.map(normalizeToolName).filter((toolName) => toolName.length > 0),
    );
    const filtered: CodexDynamicToolsHandlerMap = {};
    for (const [toolName, handler] of Object.entries(handlers)) {
      if (!disabled.has(toolName)) {
        filtered[toolName] = handler;
      }
    }
    return filtered;
  }, [config.dynamicTools?.handlers, disabledTools, toolOverrides]);

  const conversation = useCodexConversationController<
    MessagesQuery,
    ThreadStateQuery,
    DynamicToolsQuery,
    ComposerResult,
    ApprovalResult,
    InterruptResult,
    DynamicToolsRespondResult
  >({
    messages: config.messages,
    threadState: config.threadState,
    ...(config.composer !== undefined ? { composer: config.composer } : {}),
    ...(config.approvals !== undefined ? { approvals: config.approvals } : {}),
    ...(config.interrupt !== undefined ? { interrupt: config.interrupt } : {}),
    ...(config.dynamicTools === undefined
      ? {}
      : {
          dynamicTools: {
            query: config.dynamicTools.query,
            args: config.dynamicTools.args,
            ...(config.dynamicTools.respond !== undefined ? { respond: config.dynamicTools.respond } : {}),
            ...(config.dynamicTools.autoHandle !== undefined
              ? { autoHandle: config.dynamicTools.autoHandle }
              : {}),
            ...(config.dynamicTools.enabled !== undefined
              ? { enabled: config.dynamicTools.enabled }
              : {}),
            handlers: effectiveHandlers,
          },
        }),
    ...(config.syncHydration === undefined
      ? {}
      : {
          syncHydration: config.syncHydration,
        }),
  });

  const tools = useMemo<CodexChatTools>(
    () => ({
      disabledTools: normalizeToolList(disabledTools),
      overrideTools: normalizeToolList(Object.keys(toolOverrides)),
      isToolDisabled,
      disableTools,
      enableTools,
      overrideToolHandler,
      removeToolOverride,
      clearToolOverrides,
      setToolOverrides: setToolOverridesAction,
    }),
    [
      clearToolOverrides,
      disableTools,
      disabledTools,
      enableTools,
      isToolDisabled,
      overrideToolHandler,
      removeToolOverride,
      setToolOverridesAction,
      toolOverrides,
    ],
  );

  return useMemo(
    () => ({
      ...conversation,
      tools,
    }),
    [conversation, tools],
  );
}
