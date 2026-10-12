import { DEFAULT_APPEARANCE, type AppearanceDto } from '@edu-diary/contracts';
import { createContext, useContext } from 'react';

import { useAppearance } from '../lib/queries';

/**
 * Оформление уроков на клиенте: значки событий и цвета предметов.
 *
 * Значение общее для заведения и читается один раз (React Query держит кэш),
 * поэтому провайдер один на приложение. Пока данные не загрузились, работает
 * `DEFAULT_APPEARANCE`: оформление не должно задерживать интерфейс.
 */

const AppearanceContext = createContext<AppearanceDto>(DEFAULT_APPEARANCE);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const appearance = useAppearance();

  return (
    <AppearanceContext.Provider value={appearance.data ?? DEFAULT_APPEARANCE}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearanceSettings(): AppearanceDto {
  return useContext(AppearanceContext);
}
