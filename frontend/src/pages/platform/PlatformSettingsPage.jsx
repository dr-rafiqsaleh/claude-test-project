import { Mail, Settings2 } from 'lucide-react'
import { useState } from 'react'

import { PlatformEmailSettings } from '@/components/platform/PlatformEmailSettings'
import { PageHeader } from '@/components/ui/page'
import { cn } from '@/lib/utils'

const TABS = [{ key: 'email', label: 'Email', icon: Mail }]

/**
 * PestBase's own settings, shared by every client.
 *
 * Only email so far, which is why there is a single tab - the tab bar is here
 * because the next platform-wide setting has an obvious place to go, and moving
 * one panel into tabs later is a worse change than starting with them.
 */
export function PlatformSettingsPage() {
  const [activeTab, setActiveTab] = useState('email')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Platform settings"
        description="PestBase's own configuration, shared by every client company."
        badge={<Settings2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={isActive}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'email' ? <PlatformEmailSettings /> : null}
    </div>
  )
}

export default PlatformSettingsPage
