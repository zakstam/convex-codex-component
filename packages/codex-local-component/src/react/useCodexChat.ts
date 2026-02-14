"use client";

import { useCallback, useMemo, useState } from "react";
import type { FunctionArgs } from "convex/server";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexMessagesQuery } from "./types.js";
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

export type CodexChatDynamicToolsConfig<
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
> = {
  query: DynamicToolsQuery;
  args: FunctionArgs<DynamicToolsQuery> | "skip";
  respond?: CodexDynamicToolsRespond;
  handlers?: CodexDynamicToolsHandlerMap;
  autoHandle?: boolean;
  enabled?: boolean;
  disabledTools?: readonly string[];
  handlerOverrides?: CodexDynamicToolsHandlerMap;
};

export type CodexChatConfig<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
> = Omit<
  CodexConversationControllerConfig<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>,
  "dynamicTools"
> & {
  dynamicTools?: CodexChatDynamicToolsConfig<DynamicToolsQuery>;
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
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
> = ReturnType<typeof useCodexConversationController<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>> & {
  tools: CodexChatTools;
};

export type CodexChatResult<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
> = CodexChatResultState<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>;

export type CodexChatOptions<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>> = CodexDynamicToolsQuery<
    Record<string, unknown>
  >,
> = CodexChatConfig<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>;

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
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>> = CodexDynamicToolsQuery<
    Record<string, unknown>
  >,
>(config: CodexChatOptions<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>): CodexChatResult<
  MessagesQuery,
  ThreadStateQuery,
  DynamicToolsQuery
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

  const conversation = useCodexConversationController<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>({
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
