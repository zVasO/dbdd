import type { Theme } from '@/lib/themeTypes';

interface Props {
  theme: Theme;
}

export function ThemePreview({ theme }: Props) {
  const c = theme.colors;

  return (
    <div
      className="rounded-lg border overflow-hidden text-sm h-full"
      style={{
        background: c.background,
        color: c.foreground,
        borderColor: c.border,
        fontFamily: theme.typography.fontSans,
        borderRadius: theme.layout.radius,
      }}
    >
      <div className="flex h-full">
        {/* Mini sidebar */}
        <div
          className="w-40 border-r p-3 flex flex-col gap-2 shrink-0"
          style={{ background: c.sidebar, color: c.sidebarForeground, borderColor: c.border }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Explorer</div>
          <SidebarItem color={c.sidebarAccent} textColor={c.sidebarAccentForeground} active>
            users
          </SidebarItem>
          <SidebarItem color={c.sidebarAccent} textColor={c.sidebarForeground}>
            orders
          </SidebarItem>
          <SidebarItem color={c.sidebarAccent} textColor={c.sidebarForeground}>
            products
          </SidebarItem>
          <div className="mt-auto pt-2 border-t" style={{ borderColor: c.border }}>
            <div className="text-[10px] opacity-50">3 tables</div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab bar */}
          <div className="flex border-b px-2 gap-1 h-8 items-end" style={{ borderColor: c.border, background: c.background }}>
            <div
              className="px-3 py-1 text-xs rounded-t border border-b-0"
              style={{ background: c.card, borderColor: c.border, color: c.foreground }}
            >
              Query 1
            </div>
            <div className="px-3 py-1 text-xs opacity-50">Query 2</div>
          </div>

          {/* Editor mock */}
          <div className="p-3 border-b" style={{ borderColor: c.border, background: c.card }}>
            <div className="font-mono text-xs space-y-1" style={{ fontFamily: theme.typography.fontMono }}>
              <div>
                <span style={{ color: c.primary }}>SELECT</span>
                <span> * </span>
                <span style={{ color: c.primary }}>FROM</span>
                <span> users</span>
              </div>
              <div>
                <span style={{ color: c.primary }}>WHERE</span>
                <span> active = </span>
                <span style={{ color: c.chart1 }}>true</span>
              </div>
              <div>
                <span style={{ color: c.primary }}>ORDER BY</span>
                <span> created_at </span>
                <span style={{ color: c.primary }}>DESC</span>
                <span>;</span>
              </div>
            </div>
          </div>

          {/* Results mock */}
          <div className="flex-1 p-3 overflow-hidden" style={{ background: c.background }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderColor: c.border }}>
                  <th className="text-left py-1 px-2 border-b font-medium" style={{ borderColor: c.border, color: c.mutedForeground }}>id</th>
                  <th className="text-left py-1 px-2 border-b font-medium" style={{ borderColor: c.border, color: c.mutedForeground }}>name</th>
                  <th className="text-left py-1 px-2 border-b font-medium" style={{ borderColor: c.border, color: c.mutedForeground }}>email</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border }}>1</td>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border }}>Alice</td>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border, color: c.primary }}>alice@example.com</td>
                </tr>
                <tr style={{ background: c.muted }}>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border }}>2</td>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border }}>Bob</td>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border, color: c.primary }}>bob@example.com</td>
                </tr>
                <tr>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border }}>3</td>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border }}>Charlie</td>
                  <td className="py-1 px-2 border-b" style={{ borderColor: c.border, color: c.primary }}>charlie@example.com</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Components preview */}
          <div className="p-3 border-t flex flex-wrap gap-2 items-center" style={{ borderColor: c.border, background: c.card }}>
            <button className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: c.primary, color: c.primaryForeground, borderRadius: `calc(${theme.layout.radius} - 4px)` }}>
              Primary
            </button>
            <button className="px-3 py-1.5 rounded text-xs font-medium border" style={{ background: 'transparent', color: c.foreground, borderColor: c.border, borderRadius: `calc(${theme.layout.radius} - 4px)` }}>
              Outline
            </button>
            <button className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: c.destructive, color: c.destructiveForeground, borderRadius: `calc(${theme.layout.radius} - 4px)` }}>
              Destructive
            </button>
            <span className="px-2 py-0.5 text-[10px] rounded-full font-medium" style={{ background: c.accent, color: c.accentForeground }}>
              Badge
            </span>
            <div className="px-2 py-1 rounded border text-xs" style={{ background: c.background, borderColor: c.input, color: c.mutedForeground, borderRadius: `calc(${theme.layout.radius} - 4px)` }}>
              Search...
            </div>
          </div>

          {/* Status bar */}
          <div className="px-3 py-1 flex items-center gap-3 text-[10px]" style={{ background: c.primary, color: c.primaryForeground }}>
            <span>Connected</span>
            <span className="opacity-70">PostgreSQL</span>
            <span className="ml-auto opacity-70">3 rows</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ children, color, textColor, active }: { children: React.ReactNode; color: string; textColor: string; active?: boolean }) {
  return (
    <div
      className="px-2 py-1 rounded text-xs cursor-default"
      style={{
        background: active ? color : 'transparent',
        color: textColor,
      }}
    >
      {children}
    </div>
  );
}
