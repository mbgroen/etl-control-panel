import { HardDrive, History, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field, Input, Panel, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import type { ControlPanelSettings } from '../lib/types';

/**
 * Settings for the control panel itself.
 *
 * These used to sit in a tab on the Configuration page, next to the tabs that
 * edit the game server's config file. That put two unrelated things behind one
 * word: everything else under Configuration is a cvar the engine reads, shares
 * a revision and a backup, and can be reverted by restoring a snapshot — none
 * of which is true here. Anyone looking for the upload limit had to know it was
 * filed under the game server's settings, which it never was.
 *
 * Administrator accounts used to live here too. They moved to their own screen
 * once there could be more than one of them: adding and removing people is a
 * task in its own right, not a footnote under a page about upload limits.
 */
export function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<ControlPanelSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await api.system.settings();
      setSettings(current);
      setDraft({
        maxUploadMb: String(current.maxUploadMb),
        maxBackups: String(current.maxBackups),
        maxPlayerSessions: String(current.maxPlayerSessions),
      });
    } catch (err) {
      toast.error(
        'Could not load settings',
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !settings) return <Spinner label="Loading settings" />;
  if (!settings) return null;

  const { limits } = settings;

  const numbers = {
    maxUploadMb: Number(draft.maxUploadMb),
    maxBackups: Number(draft.maxBackups),
    maxPlayerSessions: Number(draft.maxPlayerSessions),
  };

  const within = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;

  const valid =
    within(numbers.maxUploadMb, limits.minUploadMb, limits.maxUploadMb) &&
    within(numbers.maxBackups, limits.minBackups, limits.maxBackups) &&
    within(numbers.maxPlayerSessions, limits.minPlayerSessions, limits.maxPlayerSessions);

  const changed =
    valid &&
    (numbers.maxUploadMb !== settings.maxUploadMb ||
      numbers.maxBackups !== settings.maxBackups ||
      numbers.maxPlayerSessions !== settings.maxPlayerSessions);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.system.saveSettings(numbers);
      setSettings(saved);
      toast.success('Settings saved', 'They apply to the next upload, save and visit.');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () =>
    setDraft({
      maxUploadMb: String(settings.maxUploadMb),
      maxBackups: String(settings.maxBackups),
      maxPlayerSessions: String(settings.maxPlayerSessions),
    });

  const numberField = (
    key: keyof typeof numbers,
    label: string,
    icon: React.ReactNode,
    min: number,
    max: number,
    unit: string,
    hint: string,
  ) => (
    <Field
      label={label}
      htmlFor={`setting-${key}`}
      error={
        draft[key] !== '' && !within(numbers[key], min, max)
          ? `Enter a whole number between ${min} and ${max}`
          : undefined
      }
      hint={hint}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted" aria-hidden>
          {icon}
        </span>
        <Input
          id={`setting-${key}`}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft[key] ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
          className="max-w-32"
        />
        <span className="text-[13px] text-muted">{unit}</span>
      </div>
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Control panel settings"
        description="Preferences for the control panel itself. Not part of the server config, and unaffected by restoring a config backup."
      >
        <div className="flex max-w-xl flex-col gap-5">
          {numberField(
            'maxUploadMb',
            'Maximum upload size',
            <Upload size={15} />,
            limits.minUploadMb,
            limits.maxUploadMb,
            'MB',
            `Per .pk3 file. An upload is written to temporary space before it moves into etmain, so allow roughly twice the file size in free disk while it transfers. Ceiling ${limits.maxUploadMb} MB.`,
          )}

          {numberField(
            'maxBackups',
            'Config backups kept',
            <History size={15} />,
            limits.minBackups,
            limits.maxBackups,
            'backups',
            'A snapshot is taken before every config save. Once this many exist, the oldest is removed to make room.',
          )}

          {numberField(
            'maxPlayerSessions',
            'Player visits kept',
            <HardDrive size={15} />,
            limits.minPlayerSessions,
            limits.maxPlayerSessions,
            'visits',
            'Finished visits shown under Players. Older ones are dropped once the limit is reached; you can also delete them individually there.',
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={saving} disabled={!changed} onClick={() => void save()}>
              Save
            </Button>
            {changed && (
              <Button onClick={reset} disabled={saving}>
                Discard
              </Button>
            )}
            {!changed && valid && (
              <span className="text-xs text-muted">Applied without a restart.</span>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
