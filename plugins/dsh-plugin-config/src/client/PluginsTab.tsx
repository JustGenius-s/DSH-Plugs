import { useCallback, useState } from 'react'
import { IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { SettingsSection, StatusText } from '@just-genius/dsh-plugin-ui'
import { InstalledSection, type InstalledSectionInjected } from './InstalledSection.tsx'
import { MarketplaceSection, type MarketplaceSectionInjected } from './MarketplaceSection.tsx'
import { UpdatesSection, type UpdatesSectionInjected } from './UpdatesSection.tsx'
import type { PluginsKey } from './locales.ts'
import styles from './PluginsTab.module.css'

export type PluginsTabInjected =
  & InstalledSectionInjected
  & UpdatesSectionInjected
  & MarketplaceSectionInjected

type Translate = (key: PluginsKey) => string

export function PluginsTab(props: PluginsTabInjected & { t: Translate }) {
  const { t, ...injected } = props
  const [query, setQuery] = useState('')
  const [installedOpen, setInstalledOpen] = useState(true)
  const [installedRefresh, setInstalledRefresh] = useState(0)
  const [updatesRefresh, setUpdatesRefresh] = useState(0)
  const [marketRefresh, setMarketRefresh] = useState(0)

  const onInstalled = useCallback(() => {
    setInstalledOpen(true)
    setInstalledRefresh((value) => value + 1)
    setUpdatesRefresh((value) => value + 1)
    setMarketRefresh((value) => value + 1)
  }, [])

  const onUpdated = useCallback(() => {
    setInstalledRefresh((value) => value + 1)
    setUpdatesRefresh((value) => value + 1)
    setMarketRefresh((value) => value + 1)
  }, [])

  return (
    <SettingsSection>
      <StatusText>{t('hint')}</StatusText>
      <Input
        type="search"
        icon={<IconSearchOutline16 aria-hidden="true" />}
        value={query}
        placeholder={t('search')}
        aria-label={t('search')}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className={styles.page}>
        <InstalledSection
          loadInventory={injected.loadInventory}
          runAction={injected.runAction}
          query={query}
          open={installedOpen}
          onToggle={() => setInstalledOpen((current) => !current)}
          refreshKey={installedRefresh}
          t={t}
        />
        <UpdatesSection
          loadOutdated={injected.loadOutdated}
          updatePackage={injected.updatePackage}
          query={query}
          refreshKey={updatesRefresh}
          onUpdated={onUpdated}
          t={t}
        />
        <MarketplaceSection
          loadCatalog={injected.loadCatalog}
          listInstalled={injected.listInstalled}
          installPlugin={injected.installPlugin}
          getLocale={injected.getLocale}
          query={query}
          refreshKey={marketRefresh}
          onInstalled={onInstalled}
          t={t}
        />
      </div>
    </SettingsSection>
  )
}
