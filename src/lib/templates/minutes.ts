import { t } from '../i18n/i18n.svelte';
import type { TemplateData, TemplateEntry } from './types';
import { BOLD, H, P, PLH, ROW, T, TBL, TC, dateField, type N } from './builders';

// Meeting minutes: a facts table (date, place, time, participants, recorder) under
// the title, then numbered agenda items with a decision and an action line each.
const LABEL_W = [2400];
const VALUE_W = [7600];

function buildMinutes(): TemplateData {
  const L = t().templates.letter;
  const M = t().templates.minutes;
  const factsRow = (label: string, ...value: N[]): N =>
    ROW(
      TC({ colwidth: LABEL_W }, P(null, T(label, BOLD))),
      TC({ colwidth: VALUE_W }, P(null, ...value)),
    );
  const item = (no: number): N[] => [
    H(2, T(`${M.item} ${no}: `), PLH(M.itemTopic)),
    P(null, PLH(M.discussion)),
    P(null, T(M.decision, BOLD), PLH(M.decisionText)),
    P(null, T(M.action, BOLD), PLH(M.actionTask), T(M.actionOwner), PLH(M.ownerName), T(M.actionDue), PLH(M.dueDate)),
  ];
  return {
    margins: { top: 2, bottom: 2, left: 2, right: 2 },
    content: {
      type: 'doc',
      content: [
        H(1, T(M.title), PLH(M.topic)),
        P(null),
        TBL({ tableStyle: 'Simple Grid' },
          factsRow(M.dateLabel, dateField()),
          factsRow(M.place, PLH(L.place)),
          factsRow(M.time, PLH(M.timeValue)),
          factsRow(M.participants, PLH(M.participantNames)),
          factsRow(M.recorder, PLH(M.recorderName)),
        ),
        P(null),
        ...item(1),
        P(null),
        ...item(2),
        P(null),
        P(null, T(M.next, BOLD), PLH(M.dueDate)),
      ],
    },
  };
}

export const minutes: TemplateEntry = {
  id: 'minutes',
  name: () => t().templates.minutes.name,
  description: () => t().templates.minutes.description,
  build: buildMinutes,
};
