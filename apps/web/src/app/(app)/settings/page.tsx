'use client';

import type { Settings } from '@kosh/contracts';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/auth-provider';
import { useFormat } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { clientDb } from '@/lib/firebase/client';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Choice({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={onChange}
      className="grid gap-2 sm:grid-cols-3"
    >
      {options.map((o) => (
        <Label
          key={o.value}
          htmlFor={`${name}-${o.value}`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
        >
          <RadioGroupItem id={`${name}-${o.value}`} value={o.value} className="mt-0.5" />
          <span className="space-y-0.5">
            <span className="block font-medium">{o.label}</span>
            {o.hint && (
              <span className="num block text-xs font-normal text-muted-foreground">{o.hint}</span>
            )}
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, ready } = useFormat();
  const [saving, setSaving] = useState(false);

  async function save(patch: Partial<Settings>) {
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(clientDb(), `users/${user.uid}`), {
        settings: { ...settings, ...patch },
        updatedAt: serverTimestamp(),
      });
      toast.success('Settings saved');
    } catch {
      toast.error('Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <Skeleton className="h-96" />;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Number format</CardTitle>
          <CardDescription>How amounts are grouped across Kosh.</CardDescription>
        </CardHeader>
        <CardContent>
          <Choice
            name="number-format"
            label="Number format"
            value={settings.numberFormat}
            onChange={(v) => save({ numberFormat: v as Settings['numberFormat'] })}
            options={[
              { value: 'indian', label: 'Indian', hint: '₹42,18,560 · ₹42.19 L' },
              { value: 'international', label: 'International', hint: '₹4,218,560 · ₹4.22M' },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Choice
            name="theme"
            label="Theme"
            value={settings.theme}
            onChange={(v) => save({ theme: v as Settings['theme'] })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email summary</CardTitle>
          <CardDescription>
            An optional summary of how your portfolio performed. Off by default; every email has a
            one-click unsubscribe. Sending starts in a later release.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="email-enabled">Send me a portfolio summary</Label>
            <Switch
              id="email-enabled"
              checked={settings.email.enabled}
              disabled={saving}
              onCheckedChange={(enabled) => save({ email: { ...settings.email, enabled } })}
            />
          </div>
          {settings.email.enabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-frequency">How often</Label>
                <Select
                  value={settings.email.frequency}
                  onValueChange={(v) =>
                    save({ email: { ...settings.email, frequency: v as 'weekly' | 'monthly' } })
                  }
                >
                  <SelectTrigger id="email-frequency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly (1st of the month)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settings.email.frequency === 'weekly' && (
                <div className="space-y-1.5">
                  <Label htmlFor="email-weekday">On</Label>
                  <Select
                    value={String(settings.email.weekday ?? 1)}
                    onValueChange={(v) =>
                      save({ email: { ...settings.email, weekday: Number(v) } })
                    }
                  >
                    <SelectTrigger id="email-weekday" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Support</CardTitle>
          <CardDescription>
            Quote this ID if you contact the administrator. It contains no personal information.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
            {user?.uid}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(user?.uid ?? '');
              toast.success('ID copied');
            }}
          >
            <Copy aria-hidden /> Copy
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
