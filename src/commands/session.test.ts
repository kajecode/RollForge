import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for the DB models before importing session.ts. Each mock is a
// simple vi.fn so we can assert on call arguments and sequencing.

const sessionFindOne = vi.fn();
const sessionFindOneAndUpdate = vi.fn();
const sessionFind = vi.fn();
const sessionUpdateOne = vi.fn();
const sessionDeleteOne = vi.fn();

vi.mock("@/db/models/Sessions.js", () => ({
  default: {
    findOne: (...args: any[]) => sessionFindOne(...args),
    findOneAndUpdate: (...args: any[]) => sessionFindOneAndUpdate(...args),
    find: (...args: any[]) => sessionFind(...args),
    updateOne: (...args: any[]) => sessionUpdateOne(...args),
    deleteOne: (...args: any[]) => sessionDeleteOne(...args),
  },
}));

const documentFindOne = vi.fn();
const documentFindOneAndUpdate = vi.fn();
const documentDeleteOne = vi.fn();
vi.mock("@/db/models/Documents.js", () => ({
  default: {
    findOne: (...args: any[]) => documentFindOne(...args),
    findOneAndUpdate: (...args: any[]) => documentFindOneAndUpdate(...args),
    deleteOne: (...args: any[]) => documentDeleteOne(...args),
  },
}));

const chunkDeleteMany = vi.fn();
const chunkInsertMany = vi.fn();
vi.mock("@/db/models/Chunks.js", () => ({
  default: {
    deleteMany: (...args: any[]) => chunkDeleteMany(...args),
    insertMany: (...args: any[]) => chunkInsertMany(...args),
  },
}));

vi.mock("@/core/embedding.js", () => ({
  embed: vi.fn(async () => [[0.1]]),
}));

vi.mock("@/core/llm.js", () => ({
  complete: vi.fn(async () => "summary text"),
}));

vi.mock("@/util/paginate.js", () => ({
  splitText: (s: string) => [s],
}));

import sessionCmd from "./session.js";

function makeInteraction(sub: string, opts: Record<string, any> = {}) {
  const optionMap = new Map(Object.entries(opts));
  return {
    guildId: "g1",
    options: {
      getSubcommand: vi.fn(() => sub),
      getString: vi.fn((name: string, _req?: boolean) => (optionMap.get(name) as string) ?? null),
      getBoolean: vi.fn((name: string) => (optionMap.get(name) as boolean) ?? null),
    },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/session forget (#19)", () => {
  it("deletes the RAG document + chunks + the session row", async () => {
    const docId = { toString: () => "doc-1" };
    documentFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: docId }),
    });
    sessionDeleteOne.mockResolvedValue({ deletedCount: 1 });

    const interaction = makeInteraction("forget", { title: "Session 12" });
    await sessionCmd(interaction);

    // Document lookup uses the campaignId + docTitle + session source
    const docFindArgs = documentFindOne.mock.calls[0][0];
    expect(docFindArgs.title).toBe("Session: Session 12");
    expect(docFindArgs.source).toBe("session:g1:Session 12");

    // Chunk cleanup happens BEFORE the Document delete
    expect(chunkDeleteMany).toHaveBeenCalledWith({ documentId: docId });
    expect(documentDeleteOne).toHaveBeenCalledWith({ _id: docId });

    // Session row cleanup
    expect(sessionDeleteOne).toHaveBeenCalledWith({
      guildId: "g1",
      campaignId: "default",
      title: "Session 12",
    });

    expect(interaction.editReply).toHaveBeenCalled();
    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toMatch(/Forgot \*\*Session 12\*\*/);
    expect(reply).toMatch(/session row/);
    expect(reply).toMatch(/ingested RAG doc \+ chunks/);
  });

  it("skips Document work when no ingested doc exists", async () => {
    documentFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });
    sessionDeleteOne.mockResolvedValue({ deletedCount: 1 });

    const interaction = makeInteraction("forget", { title: "Session 5" });
    await sessionCmd(interaction);

    expect(chunkDeleteMany).not.toHaveBeenCalled();
    expect(documentDeleteOne).not.toHaveBeenCalled();
    expect(sessionDeleteOne).toHaveBeenCalled();
    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toMatch(/session row/);
    expect(reply).not.toMatch(/ingested RAG doc/);
  });

  it("reports nothing-to-do when both the session and doc are already absent", async () => {
    documentFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });
    sessionDeleteOne.mockResolvedValue({ deletedCount: 0 });

    const interaction = makeInteraction("forget", { title: "Session 99" });
    await sessionCmd(interaction);

    expect(chunkDeleteMany).not.toHaveBeenCalled();
    expect(documentDeleteOne).not.toHaveBeenCalled();
    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toMatch(/No session or ingested doc found/);
  });
});
