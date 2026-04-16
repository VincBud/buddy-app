import * as Calendar from 'expo-calendar';

import i18n from './i18n';
import { Job } from './jobs';

const DEFAULT_EVENT_DURATION_MINUTES = 60;

const parseAppointmentDateParts = (value: string): { year: number; month: number; day: number } | null => {
  const trimmed = String(value || '').trim();
  const germanMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (germanMatch) {
    const [, day, month, year] = germanMatch;
    return {
      day: Number(day),
      month: Number(month),
      year: Number(year),
    };
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return {
      day: Number(day),
      month: Number(month),
      year: Number(year),
    };
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      day: parsed.getDate(),
      month: parsed.getMonth() + 1,
      year: parsed.getFullYear(),
    };
  }

  return null;
};

const parseAppointmentTimeParts = (value: string): { hours: number; minutes: number } | null => {
  const trimmed = String(value || '').trim();
  const normalized = trimmed.replace(/\s*uhr$/i, '').trim();
  const match = normalized.match(/^(\d{1,2})[:.](\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
};

const buildAppointmentStartDate = (job: Pick<Job, 'appointmentDate' | 'appointmentTime'>): Date | null => {
  const dateParts = parseAppointmentDateParts(String(job.appointmentDate || ''));
  const timeParts = parseAppointmentTimeParts(String(job.appointmentTime || ''));

  if (!dateParts || !timeParts) return null;

  const startDate = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    0,
    0
  );

  if (
    Number.isNaN(startDate.getTime()) ||
    startDate.getFullYear() !== dateParts.year ||
    startDate.getMonth() !== dateParts.month - 1 ||
    startDate.getDate() !== dateParts.day ||
    startDate.getHours() !== timeParts.hours ||
    startDate.getMinutes() !== timeParts.minutes
  ) {
    return null;
  }

  return startDate;
};

const getEventTitle = (job: Pick<Job, 'problem'>): string => {
  const problem = String(job.problem || '').trim() || i18n.t('job.detail_type_default');
  return i18n.t('calendar.event_title', { problem });
};

const getEventNotes = (job: Pick<Job, 'problem' | 'creatorName' | 'price'>): string => {
  const lines = [
    i18n.t('calendar.event_notes_problem', {
      problem: String(job.problem || '').trim(),
    }),
  ];

  if (job.creatorName) {
    lines.push(
      i18n.t('calendar.event_notes_requester', {
        name: job.creatorName,
      })
    );
  }

  if (job.price) {
    lines.push(
      i18n.t('calendar.event_notes_price', {
        price: job.price,
      })
    );
  }

  return lines.filter(Boolean).join('\n');
};

export const canOfferCalendarForJob = (
  job: Pick<Job, 'timeMode' | 'appointmentDate' | 'appointmentTime'>
): boolean => {
  if (job.timeMode !== 'termin') return false;
  return buildAppointmentStartDate(job) !== null;
};

export const openCalendarComposerForJob = async (
  job: Pick<
    Job,
    'timeMode' | 'appointmentDate' | 'appointmentTime' | 'problem' | 'creatorName' | 'price'
  >
): Promise<'opened' | 'invalid' | 'unavailable' | 'failed'> => {
  if (job.timeMode !== 'termin') return 'invalid';

  const startDate = buildAppointmentStartDate(job);
  if (!startDate) return 'invalid';

  const isAvailable = await Calendar.isAvailableAsync();
  if (!isAvailable) return 'unavailable';

  const endDate = new Date(
    startDate.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60 * 1000
  );

  try {
    await Calendar.createEventInCalendarAsync({
      title: getEventTitle(job),
      startDate,
      endDate,
      notes: getEventNotes(job),
    });
    return 'opened';
  } catch (error) {
    console.error('Could not open calendar composer:', error);
    return 'failed';
  }
};