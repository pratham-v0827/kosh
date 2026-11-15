'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * BUG-023: sonner's rich colours put mid-tone text on pale backgrounds (success, warning and
 * error fell below WCAG AA 4.5:1 in axe). In light mode the text is darkened; the dark-mode
 * defaults already pass.
 */
const LIGHT_RICH_TEXT = {
  '--success-text': '#166534',
  '--info-text': '#1e40af',
  '--warning-text': '#92400e',
  '--error-text': '#991b1b',
} as React.CSSProperties;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system', resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          ...(resolvedTheme === 'dark' ? {} : LIGHT_RICH_TEXT),
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
