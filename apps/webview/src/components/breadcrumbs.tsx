import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from 'react';

export interface BreadcrumbItem {
  title: string;
  href?: string;
}

const BreadcrumbContext = createContext<BreadcrumbItem[]>([]);

export function BreadcrumbProvider({
  children,
  items = [],
}: {
  children: ReactNode;
  items?: BreadcrumbItem[];
}): ReactElement {
  return <BreadcrumbContext.Provider value={items}>{children}</BreadcrumbContext.Provider>;
}

export function BreadcrumbSegment({
  children,
  title,
  href,
}: {
  children: ReactNode;
  title: string;
  href?: string;
}): ReactElement {
  const parent = useContext(BreadcrumbContext);
  const items = useMemo(() => [...parent, { title, href }], [href, parent, title]);
  return <BreadcrumbProvider items={items}>{children}</BreadcrumbProvider>;
}

export function BreadcrumbCurrent({ title }: { title: string }): ReactElement {
  const parent = useContext(BreadcrumbContext);
  const items = [...parent, { title }];

  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
      <ol className="flex items-center gap-1.5">
        {items.map((item, index) => (
          <li className="flex items-center gap-1.5" key={`${item.title}:${item.href ?? index}`}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <a className="hover:text-foreground" href={item.href}>
                {item.title}
              </a>
            ) : (
              <span className="text-foreground">{item.title}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
