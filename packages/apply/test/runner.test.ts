import { describe, expect, it } from "vitest";
import type { JsonResumeProfile } from "@jobpilot/core";
import { runApplication, type RawControl, type RunnerPage } from "../src/runner.js";

interface Scenario {
  controls: RawControl[];
  text: string;
  buttons: string[];
  /** State the page moves to after a button is clicked. */
  afterClick?: { text: string; controls?: RawControl[]; buttons?: string[] };
}

class FakePage implements RunnerPage {
  visited: string[] = [];
  filled: Record<string, string> = {};
  attached: string[] = [];
  clicked: number[] = [];
  private scenario: Scenario | null = null;

  constructor(private readonly scenarios: Record<string, Scenario>) {}

  async goto(url: string): Promise<void> {
    this.visited.push(url);
    const scenario = this.scenarios[url];
    if (!scenario) throw new Error(`No fake page for ${url}`);
    this.scenario = scenario;
  }

  async controls(): Promise<RawControl[]> {
    return this.scenario?.controls ?? [];
  }

  async buttonIndices(pattern: string): Promise<number[]> {
    const matcher = new RegExp(pattern, "i");
    return (this.scenario?.buttons ?? [])
      .map((text, index) => (matcher.test(text) ? index : -1))
      .filter((index) => index >= 0);
  }

  async fill(control: RawControl, value: string): Promise<void> {
    this.filled[control.name || control.id || String(control.index)] = value;
  }

  async attach(_control: RawControl, path: string): Promise<void> {
    this.attached.push(path);
  }

  async clickButton(index: number): Promise<void> {
    this.clicked.push(index);
    const after = this.scenario?.afterClick;
    if (this.scenario && after) {
      this.scenario = {
        controls: after.controls ?? [],
        text: after.text,
        buttons: after.buttons ?? [],
      };
    }
  }

  async bodyText(): Promise<string> {
    return this.scenario?.text ?? "";
  }
}

const profile: Pick<JsonResumeProfile, "basics"> = {
  basics: { name: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 7946 0000" },
};

function control(index: number, label: string, name: string, type = "text"): RawControl {
  return { index, label, name, id: name, autocomplete: "", type };
}

const greenhouse: Scenario = {
  controls: [
    control(0, "First name", "first_name"),
    control(1, "Last name", "last_name"),
    control(2, "Email", "email", "email"),
    control(3, "Phone", "phone"),
    control(4, "Resume", "resume", "file"),
    control(5, "Cover letter", "cover_letter", "textarea"),
  ],
  text: "Greenhouse fixture",
  buttons: ["Submit application"],
  afterClick: { text: "Application received. Reference: MOCK-1" },
};

describe("gate 4.5: the runner refuses to navigate when the gate blocks", () => {
  it("stops before goto when the kill switch is on", async () => {
    const page = new FakePage({});
    const result = await runApplication({
      page,
      url: "http://localhost:4600/greenhouse/sample",
      profile,
      preflight: {
        settings: { killSwitch: true, allowSubmit: true, dailyCap: 10, mode: "COPILOT" },
        submissionsToday: 0,
        now: new Date(),
      },
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.reason).toBe("KILL_SWITCH");
    expect(page.visited).toEqual([]);
    expect(page.clicked).toEqual([]);
  });
});

describe("gate 4.7/4.9: a full run fills, attaches and reports every action", () => {
  it("submits once and records the action sequence", async () => {
    const page = new FakePage({ "http://localhost:4600/greenhouse/sample": greenhouse });
    const result = await runApplication({
      page,
      url: "http://localhost:4600/greenhouse/sample",
      profile,
      resumePath: "C:/tmp/ada-resume.pdf",
      answers: [{ key: "cover_letter", answer: "I would love to join." }],
    });

    expect(result.status).toBe("SUBMITTED");
    expect(result.submissionText).toContain("Application received");
    expect(page.filled.first_name).toBe("Ada");
    expect(page.filled.last_name).toBe("Lovelace");
    expect(page.filled.email).toBe("ada@example.com");
    expect(page.filled.cover_letter).toBe("I would love to join.");
    expect(page.attached).toEqual(["C:/tmp/ada-resume.pdf"]);
    expect(page.clicked).toHaveLength(1);

    const kinds = result.actions.map((action) => action.kind);
    expect(kinds).toContain("NAVIGATE");
    expect(kinds).toContain("ATTACH");
    // first name, last name, email, phone, cover letter: the resume is attached.
    expect(kinds.filter((kind) => kind === "FILL").length).toBe(5);
    expect(kinds.at(-1)).toBe("SUBMIT");
  });
});

describe("gate 4.8: human-only pages pause the run (I4)", () => {
  it("pauses on a CAPTCHA without clicking anything", async () => {
    const page = new FakePage({
      "http://localhost:4600/edge/captcha": {
        controls: [],
        text: "CAPTCHA fixture Complete the challenge to continue.",
        buttons: [],
      },
    });
    const result = await runApplication({
      page,
      url: "http://localhost:4600/edge/captcha",
      profile,
    });
    expect(result.status).toBe("PAUSED_NEEDS_HUMAN");
    expect(result.reason).toBe("CAPTCHA");
    expect(page.clicked).toEqual([]);
  });

  it("pauses on an expired session", async () => {
    const page = new FakePage({
      "http://localhost:4600/edge/session-expired": {
        controls: [],
        text: "Session expired Your session has expired. Please sign in again.",
        buttons: [],
      },
    });
    const result = await runApplication({
      page,
      url: "http://localhost:4600/edge/session-expired",
      profile,
    });
    expect(result.reason).toBe("SESSION_EXPIRED");
  });

  it("pauses on a login wall", async () => {
    const page = new FakePage({
      "http://localhost:4600/wall": {
        controls: [control(0, "Password", "password", "password")],
        text: "Sign in to continue",
        buttons: ["Sign in"],
      },
    });
    const result = await runApplication({ page, url: "http://localhost:4600/wall", profile });
    expect(result.reason).toBe("LOGIN_WALL");
  });
});

describe("gate 4.10: a multi-section form is never partially submitted", () => {
  const multiStep: Scenario = {
    controls: [
      control(0, "Email", "email", "email"),
      control(1, "Years of experience", "years"),
    ],
    text: "Multi-step fixture",
    buttons: ["Next step"],
    afterClick: { text: "Application received. Reference: MOCK-2" },
  };

  it("pauses before clicking when a question has no answer (I5)", async () => {
    const page = new FakePage({ "http://localhost:4600/edge/multi-step": multiStep });
    const result = await runApplication({
      page,
      url: "http://localhost:4600/edge/multi-step",
      profile,
    });
    expect(result.status).toBe("PAUSED_NEEDS_HUMAN");
    expect(result.reason).toBe("NEEDS_HUMAN_FIELDS");
    expect(page.clicked).toEqual([]);
    expect(result.needsHuman.map((field) => field.key)).toEqual(["years_experience"]);
  });

  it("advances once the Answer Bank resolves every field", async () => {
    const page = new FakePage({ "http://localhost:4600/edge/multi-step": multiStep });
    const result = await runApplication({
      page,
      url: "http://localhost:4600/edge/multi-step",
      profile,
      answers: [{ key: "years_experience", answer: "8" }],
    });
    expect(result.status).toBe("SUBMITTED");
    expect(page.filled.years).toBe("8");
    expect(page.clicked).toEqual([0]);
  });
});