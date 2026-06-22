import {
  Breadcrumb,
  BreadcrumbItem as CossBreadcrumbItem,
  BreadcrumbLink as CossBreadcrumbLink,
  BreadcrumbList as CossBreadcrumbList,
  BreadcrumbPage as CossBreadcrumbPage,
  BreadcrumbSeparator as CossBreadcrumbSeparator,
} from 'coss-ui/components/breadcrumb';
import { createBreadcrumbs } from 'foxact/breadcrumbs';
import { Fragment } from 'react';
import { Link } from 'react-router';

const [BreadcrumbProvider, BreadcrumbPortalTarget, BreadcrumbSegment, FoxactBreadcrumbCurrent, useBreadcrumbs] =
  createBreadcrumbs('linkcode-webview');

export { BreadcrumbPortalTarget, BreadcrumbProvider, BreadcrumbSegment };

function BreadcrumbUI() {
  const items = useBreadcrumbs();
  return (
    <Breadcrumb>
      <CossBreadcrumbList>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={`${item.title}:${item.href ?? ''}`}>
              {i > 0 && <CossBreadcrumbSeparator className="hidden md:block" />}
              <CossBreadcrumbItem className={isLast ? undefined : 'hidden md:block'}>
                {item.href ? (
                  <CossBreadcrumbLink render={<Link to={item.href} />}>{item.title}</CossBreadcrumbLink>
                ) : (
                  <CossBreadcrumbPage>{item.title}</CossBreadcrumbPage>
                )}
              </CossBreadcrumbItem>
            </Fragment>
          );
        })}
      </CossBreadcrumbList>
    </Breadcrumb>
  );
}

export function BreadcrumbCurrent({ title, meta }: { title: string; meta?: unknown }) {
  return (
    <FoxactBreadcrumbCurrent title={title} meta={meta}>
      <BreadcrumbUI />
    </FoxactBreadcrumbCurrent>
  );
}
