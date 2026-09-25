import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: '趋势交易信号工作台',
  description: 'Trend Signal Desk',
};

/**
 * The terminal is the original standalone workspace supplied by the site owner.
 * Keeping it in a same-origin iframe preserves its source UI while preventing
 * its global workbench CSS from leaking into the main research site.
 */
export default function TerminalPage() {
  return (
    <section className="trend-signal-terminal-shell" aria-label="趋势交易信号工作台">
      <iframe
        className="trend-signal-terminal-frame"
        src="/terminal-source/index.html?build=20260925-voice-v1"
        title="趋势交易信号工作台"
        allow="clipboard-write; fullscreen"
        referrerPolicy="same-origin"
      />
    </section>
  );
}
