/** Tools actions tests. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelsClient } from "../../api/channels-client.js";
import { ApiRequestError } from "../../api/http.js";
import type { IntegrationsClient } from "../../api/integrations-client.js";
import type { ToolsAction } from "../tools-slice.js";
import { toolsActions } from "../app-actions.js";

describe("toolsActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载连接遇到 composio_not_configured 时静默忽略集成错误并保留渠道状态", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createFailingIntegrationsClient(
      new ApiRequestError("尚未配置 Composio 鉴权服务", 400, "composio_not_configured", "req-1")
    );

    await toolsActions.loadConnections(
      client,
      createChannelsClient([
        {
          id: "channel-wechat-local",
          provider: "wechat",
          runtimeChannel: "weixin",
          status: "connected",
          running: true,
          displayName: "WeChat"
        }
      ]),
      dispatch
    );

    expect(dispatch).toHaveBeenCalledWith({ type: "tools/loadStart" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "tools/loadSuccess",
      connections: [{ id: "channel-wechat-local", toolkit: "wechat", status: "connected", surface: "channel", lastError: null }]
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "tools/loadFailure" }));
    expect(warn).toHaveBeenCalledWith(
      "[tools] integration setup diagnostic hidden from product UI:",
      expect.objectContaining({ code: "composio_not_configured" })
    );
  });

  it("首次加载只读取连接列表，工具目录不依赖 Cloud 能力清单", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();
    const client: IntegrationsClient = {
      authorize: vi.fn(async () => ({ connectUrl: "https://backend.composio.dev/api/v3/s/github-test", connectionId: "conn-github" })),
      listCapabilities: vi.fn(async () => ({ toolkits: ["github"] })),
      listConnections: vi.fn(async () => ({
        connections: [{ id: "conn-github", toolkit: "github", status: "ACTIVE" }]
      })),
      deleteConnection: vi.fn(async () => undefined),
      reportConnectionEvent: vi.fn(async () => undefined)
    };

    await toolsActions.loadConnections(client, createChannelsClient([]), dispatch);

    expect(client.listCapabilities).not.toHaveBeenCalled();
    expect(client.listConnections).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "tools/loadSuccess",
      connections: [{ id: "conn-github", toolkit: "github", status: "ACTIVE", surface: "integration" }]
    });
  });

  it("渠道单独加载：只读渠道连接并派发 loadStart/loadSuccess", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();
    const channels = createChannelsClient([
      {
        id: "channel-wechat-local",
        provider: "wechat",
        runtimeChannel: "weixin",
        status: "connected",
        running: true,
        displayName: "WeChat"
      }
    ]);

    await toolsActions.loadChannelConnections(channels, dispatch);

    expect(dispatch).toHaveBeenCalledWith({ type: "tools/loadStart" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "tools/loadSuccess",
      connections: [{ id: "channel-wechat-local", toolkit: "wechat", status: "connected", surface: "channel", lastError: null }]
    });
  });

  it("渠道单独刷新：派发 connectionsUpdated 而不是 loadStart", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();

    await toolsActions.refreshChannelConnections(createChannelsClient([]), dispatch);

    expect(dispatch).toHaveBeenCalledWith({ type: "tools/connectionsUpdated", connections: [] });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "tools/loadStart" });
  });

  it("渠道加载失败时静默为空列表，不派发失败态", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const channels = createChannelsClient([]);
    channels.listConnections = vi.fn(async () => {
      throw new Error("agent down");
    });

    await toolsActions.loadChannelConnections(channels, dispatch);

    expect(dispatch).toHaveBeenCalledWith({ type: "tools/loadSuccess", connections: [] });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "tools/loadFailure" }));
  });
});

/** Creates create failing integrations client. */
function createFailingIntegrationsClient(error: unknown): IntegrationsClient {
  return {
    authorize: vi.fn(async () => {
      throw error;
    }),
    listCapabilities: vi.fn(async () => {
      throw error;
    }),
    listConnections: vi.fn(async () => {
      throw error;
    }),
    deleteConnection: vi.fn(async () => undefined),
    reportConnectionEvent: vi.fn(async () => undefined)
  };
}

/** Creates create channels client. */
function createChannelsClient(connections: Awaited<ReturnType<ChannelsClient["listConnections"]>>["connections"]): ChannelsClient {
  return {
    listDefinitions: vi.fn(async () => ({ channels: [] })),
    listConnections: vi.fn(async () => ({ connections })),
    connect: vi.fn(async () => ({ status: "connected" as const, connectionId: "channel-test-local" })),
    pollConnect: vi.fn(async () => ({ status: "connected" as const, connectionId: "channel-test-local" })),
    disconnect: vi.fn(async () => undefined),
    reportConnectionEvent: vi.fn(async () => undefined)
  };
}
