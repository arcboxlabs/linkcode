import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { ChevronRightIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only schema endpoint model, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when tools expose structured API/schema metadata.
export interface ChatSchemaEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description?: string;
  parameters?: ChatSchemaParameter[];
  requestBody?: ChatSchemaProperty[];
  responseBody?: ChatSchemaProperty[];
}

export interface ChatSchemaParameter {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  location?: 'path' | 'query' | 'header';
}

export interface ChatSchemaProperty {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  properties?: ChatSchemaProperty[];
  items?: ChatSchemaProperty;
}

export type SchemaDisplayProps = ComponentProps<'div'> & {
  endpoint: ChatSchemaEndpoint;
};

export function SchemaDisplay({
  className,
  endpoint,
  children,
  ...props
}: SchemaDisplayProps): ReactNode {
  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-lg border border-border bg-card text-[13px]',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <SchemaDisplayHeader endpoint={endpoint} />
          {endpoint.description ? (
            <SchemaDisplayDescription>{endpoint.description}</SchemaDisplayDescription>
          ) : null}
          <SchemaDisplayBody>
            {endpoint.parameters && endpoint.parameters.length > 0 ? (
              <SchemaDisplayParameters parameters={endpoint.parameters} />
            ) : null}
            {endpoint.requestBody && endpoint.requestBody.length > 0 ? (
              <SchemaDisplayProperties label="Request Body" properties={endpoint.requestBody} />
            ) : null}
            {endpoint.responseBody && endpoint.responseBody.length > 0 ? (
              <SchemaDisplayProperties label="Response" properties={endpoint.responseBody} />
            ) : null}
          </SchemaDisplayBody>
        </>
      )}
    </div>
  );
}

export type SchemaDisplayHeaderProps = ComponentProps<'div'> & {
  endpoint: ChatSchemaEndpoint;
};

export function SchemaDisplayHeader({
  className,
  endpoint,
  children,
  ...props
}: SchemaDisplayHeaderProps): ReactNode {
  return (
    <div
      className={cn('flex min-w-0 items-center gap-2 border-b border-border px-3 py-2', className)}
      {...props}
    >
      {children ?? (
        <>
          <SchemaDisplayMethod method={endpoint.method} />
          <SchemaDisplayPath path={endpoint.path} />
        </>
      )}
    </div>
  );
}

export type SchemaDisplayMethodProps = ComponentProps<typeof Badge> & {
  method: ChatSchemaEndpoint['method'];
};

export function SchemaDisplayMethod({
  className,
  method,
  children,
  ...props
}: SchemaDisplayMethodProps): ReactNode {
  return (
    <Badge className={cn('font-mono', className)} variant={methodVariant(method)} {...props}>
      {children ?? method}
    </Badge>
  );
}

export type SchemaDisplayPathProps = ComponentProps<'div'> & {
  path: string;
};

export function SchemaDisplayPath({
  className,
  path,
  children,
  ...props
}: SchemaDisplayPathProps): ReactNode {
  return (
    <div className={cn('min-w-0 truncate font-mono text-foreground', className)} {...props}>
      {children ?? renderPath(path)}
    </div>
  );
}

export type SchemaDisplayDescriptionProps = ComponentProps<'div'>;

export function SchemaDisplayDescription({
  className,
  ...props
}: SchemaDisplayDescriptionProps): ReactNode {
  return (
    <div
      className={cn('border-b border-border px-3 py-2 text-muted-foreground', className)}
      {...props}
    />
  );
}

export type SchemaDisplayBodyProps = ComponentProps<'div'>;

export function SchemaDisplayBody({ className, ...props }: SchemaDisplayBodyProps): ReactNode {
  return <div className={cn('divide-y divide-border', className)} {...props} />;
}

export type SchemaDisplayParametersProps = ComponentProps<typeof Collapsible> & {
  parameters: readonly ChatSchemaParameter[];
};

export function SchemaDisplayParameters({
  className,
  parameters,
  children,
  defaultOpen = true,
  ...props
}: SchemaDisplayParametersProps): ReactNode {
  return (
    <Collapsible className={className} defaultOpen={defaultOpen} {...props}>
      {children ?? (
        <>
          <SchemaDisplaySectionTrigger count={parameters.length} label="Parameters" />
          <CollapsibleContent className="divide-y divide-border border-t border-border">
            {parameters.map((parameter) => (
              <SchemaDisplayParameter key={parameter.id} parameter={parameter} />
            ))}
          </CollapsibleContent>
        </>
      )}
    </Collapsible>
  );
}

export type SchemaDisplayParameterProps = ComponentProps<'div'> & {
  parameter: ChatSchemaParameter;
};

export function SchemaDisplayParameter({
  className,
  parameter,
  children,
  ...props
}: SchemaDisplayParameterProps): ReactNode {
  return (
    <div className={cn('px-8 py-2', className)} {...props}>
      {children ?? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-foreground">{parameter.name}</span>
            <Badge variant="outline">{parameter.type}</Badge>
            {parameter.location ? <Badge variant="secondary">{parameter.location}</Badge> : null}
            {parameter.required ? <Badge variant="error">required</Badge> : null}
          </div>
          {parameter.description ? (
            <div className="mt-1 text-[12px] text-muted-foreground">{parameter.description}</div>
          ) : null}
        </>
      )}
    </div>
  );
}

export type SchemaDisplayPropertiesProps = ComponentProps<typeof Collapsible> & {
  label: string;
  properties: readonly ChatSchemaProperty[];
};

export function SchemaDisplayProperties({
  className,
  label,
  properties,
  children,
  defaultOpen = true,
  ...props
}: SchemaDisplayPropertiesProps): ReactNode {
  return (
    <Collapsible className={className} defaultOpen={defaultOpen} {...props}>
      {children ?? (
        <>
          <SchemaDisplaySectionTrigger count={properties.length} label={label} />
          <CollapsibleContent className="divide-y divide-border border-t border-border">
            {properties.map((schemaProperty) => (
              <SchemaDisplayProperty key={schemaProperty.id} schemaProperty={schemaProperty} />
            ))}
          </CollapsibleContent>
        </>
      )}
    </Collapsible>
  );
}

export type SchemaDisplayPropertyProps = ComponentProps<'div'> & {
  schemaProperty: ChatSchemaProperty;
  depth?: number;
};

export function SchemaDisplayProperty({
  className,
  schemaProperty,
  depth = 0,
  children,
  ...props
}: SchemaDisplayPropertyProps): ReactNode {
  const hasChildren = Boolean(schemaProperty.properties?.length || schemaProperty.items);
  const paddingLeft = `${2 + depth}rem`;

  if (hasChildren) {
    return (
      <Collapsible defaultOpen={depth < 2}>
        <div className={className} {...props}>
          <CollapsibleTrigger
            className="group flex w-full items-center gap-2 py-2 pr-3 text-left hover:bg-muted"
            style={{ paddingLeft }}
          >
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            <SchemaPropertySummary schemaProperty={schemaProperty} />
          </CollapsibleTrigger>
          {schemaProperty.description ? (
            <div className="pb-2 text-[12px] text-muted-foreground" style={{ paddingLeft }}>
              {schemaProperty.description}
            </div>
          ) : null}
          <CollapsibleContent className="divide-y divide-border border-t border-border">
            {children ??
              schemaProperty.properties?.map((child) => (
                <SchemaDisplayProperty key={child.id} depth={depth + 1} schemaProperty={child} />
              ))}
            {schemaProperty.items ? (
              <SchemaDisplayProperty depth={depth + 1} schemaProperty={schemaProperty.items} />
            ) : null}
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  }

  return (
    <div className={cn('py-2 pr-3', className)} style={{ paddingLeft }} {...props}>
      {children ?? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-3.5" />
            <SchemaPropertySummary schemaProperty={schemaProperty} />
          </div>
          {schemaProperty.description ? (
            <div className="mt-1 pl-5 text-[12px] text-muted-foreground">
              {schemaProperty.description}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export type SchemaDisplayExampleProps = ComponentProps<'pre'>;

export function SchemaDisplayExample({
  className,
  ...props
}: SchemaDisplayExampleProps): ReactNode {
  return (
    <pre
      className={cn('m-3 overflow-auto rounded-md bg-muted p-3 font-mono text-[12px]', className)}
      {...props}
    />
  );
}

function SchemaDisplaySectionTrigger({
  label,
  count,
}: {
  label: string;
  count?: number;
}): ReactNode {
  return (
    <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      <span className="font-medium text-foreground">{label}</span>
      {typeof count === 'number' ? (
        <Badge className="ml-auto" variant="secondary">
          {count}
        </Badge>
      ) : null}
    </CollapsibleTrigger>
  );
}

function SchemaPropertySummary({
  schemaProperty,
}: {
  schemaProperty: ChatSchemaProperty;
}): ReactNode {
  return (
    <>
      <span className="font-mono text-foreground">{schemaProperty.name}</span>
      <Badge variant="outline">{schemaProperty.type}</Badge>
      {schemaProperty.required ? <Badge variant="error">required</Badge> : null}
    </>
  );
}

function renderPath(path: string): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of path.matchAll(/\{[^}]+\}/g)) {
    const index = match.index;
    if (index > cursor) {
      parts.push(<span key={`text-${cursor}`}>{path.slice(cursor, index)}</span>);
    }
    const value = match[0];
    parts.push(
      <span key={`param-${index}`} className="text-info-foreground">
        {value}
      </span>,
    );
    cursor = index + value.length;
  }

  if (cursor < path.length) {
    parts.push(<span key={`text-${cursor}`}>{path.slice(cursor)}</span>);
  }

  return parts.length > 0 ? parts : path;
}

function methodVariant(
  method: ChatSchemaEndpoint['method'],
): ComponentProps<typeof Badge>['variant'] {
  switch (method) {
    case 'GET':
      return 'success';
    case 'DELETE':
      return 'error';
    case 'POST':
      return 'info';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    default:
      return 'secondary';
  }
}
