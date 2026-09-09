import { describe, expect, it } from "vitest";
import {
  eventDraft,
  eventInput,
  newEventDraft,
  startWeekday,
  validateEventDraft,
} from "./event-form-state";

describe("Event draft contract", /** Check date-only mapping and editable definition validation. */ () => {
  it("maps defaults and preserves wall time and timezone", /** Keep backend timezone resolution authoritative. */ () => {
    const draft = { ...newEventDraft("2026-09-09", "p", "Asia/Bangkok"), title: "Meeting" };
    expect(eventInput(draft)).toEqual({
      title: "Meeting",
      description: "",
      projectId: "p",
      time: {
        kind: "timed",
        startLocal: "2026-09-09T09:00:00",
        endLocal: "2026-09-09T10:00:00",
        timeZoneId: "Asia/Bangkok",
      },
      recurrence: { kind: "none" },
      reminderMinutesBefore: [10],
    });
    expect(validateEventDraft(draft)).toEqual({});
  });
  it("round trips inclusive all-day values without UTC shifting", /** Strip persisted identifiers and UTC caches from edit input. */ () => {
    const input = eventInput({
      ...newEventDraft("2026-12-31", null, "Pacific/Auckland"),
      title: "Holiday",
      allDay: true,
      endDate: "2027-01-02",
    });
    expect(input.time).toEqual({
      kind: "all_day",
      startDate: "2026-12-31",
      endDateExclusive: "2027-01-03",
      timeZoneId: "Pacific/Auckland",
    });
    const draft = eventDraft({
      id: "e",
      title: input.title,
      description: "",
      projectId: null,
      time: input.time as {
        kind: "all_day";
        startDate: string;
        endDateExclusive: string;
        timeZoneId: string;
      },
      recurrence: { kind: "none" },
      reminders: [{ id: "r", minutesBefore: 10 }],
      revision: "90071992547409930",
      createdAtMs: 0,
      updatedAtMs: 0,
    });
    expect(draft.endDate).toBe("2027-01-02");
    expect(draft.startTime).toBe("09:00");
    expect(eventInput(draft)).toEqual(input);
  });
  it("rejects year overflow, missing start weekday and invalid recurrence ends", /** Keep tagged recurrence validation explicit. */ () => {
    const draft = { ...newEventDraft("2026-09-09", null, "UTC"), title: "Meeting" };
    expect(startWeekday(draft.startDate)).toBe("wednesday");
    expect(validateEventDraft({ ...draft, allDay: true, endDate: "9999-12-31" })).toHaveProperty(
      "endDate",
    );
    expect(
      validateEventDraft({
        ...draft,
        recurrence: { kind: "weekly", weekdays: ["monday"], end: { kind: "never" } },
      }),
    ).toHaveProperty("recurrence");
    for (const recurrence of [
      { kind: "daily", end: { kind: "on_date", date: "2026-09-08" } },
      { kind: "yearly", end: { kind: "after_count", count: 0 } },
    ] as const)
      expect(validateEventDraft({ ...draft, recurrence })).toHaveProperty("recurrence");
    for (const kind of ["daily", "monthly", "yearly"] as const)
      expect(
        eventInput({ ...draft, recurrence: { kind, end: { kind: "after_count", count: 3 } } })
          .recurrence,
      ).toEqual({ kind, end: { kind: "after_count", count: 3 } });
  });
  it("counts Unicode scalars and permits zero reminders", /** Avoid UTF-16 maxlength and blank numeric coercion. */ () => {
    const draft = {
      ...newEventDraft("2026-09-09", null, "UTC"),
      title: "😀".repeat(200),
      reminderMinutes: [],
    };
    expect(validateEventDraft(draft)).toEqual({});
    expect(validateEventDraft({ ...draft, title: `${draft.title}x` })).toHaveProperty("title");
    expect(validateEventDraft({ ...draft, title: "bad\ntext" })).toHaveProperty("title");
    for (const reminderMinutes of [
      [""],
      ["10", "10"],
      ["-1"],
      ["525601"],
      Array.from(
        { length: 17 },
        /** Produce distinct excessive offsets. */ (_, index) => String(index),
      ),
    ])
      expect(validateEventDraft({ ...draft, reminderMinutes })).toHaveProperty("reminderMinutes");
  });
});
