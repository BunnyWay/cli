import type { TableSchema } from "@/api.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function SchemaTab({
  schema,
  onSelectTable,
}: {
  schema: TableSchema | null;
  onSelectTable: (name: string) => void;
}) {
  if (!schema) return null;

  return (
    <div className="flex-1 overflow-auto p-6">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Columns
      </h3>
      <Table className="mb-6">
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Name</TableHead>
            <TableHead className="text-xs">Type</TableHead>
            <TableHead className="text-xs">Nullable</TableHead>
            <TableHead className="text-xs">Default</TableHead>
            <TableHead className="text-xs">PK</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schema.columns.map((col) => (
            <TableRow key={col.name}>
              <TableCell className="font-mono text-xs">{col.name}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {col.type || "ANY"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {col.notnull ? "NOT NULL" : "NULL"}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {col.defaultValue ?? "-"}
              </TableCell>
              <TableCell className="text-xs">
                {col.primaryKey ? (
                  <Badge variant="outline" className="text-[10px]">
                    PK
                  </Badge>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {schema.foreignKeys.length > 0 && (
        <>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Foreign Keys
          </h3>
          <Table className="mb-6">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Column</TableHead>
                <TableHead className="text-xs">References</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schema.foreignKeys.map((fk) => (
                <TableRow key={`${fk.from}->${fk.table}.${fk.to}`}>
                  <TableCell className="font-mono text-xs">{fk.from}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <Button
                      variant="link"
                      onClick={() => onSelectTable(fk.table)}
                      className="h-auto p-0 font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:no-underline"
                    >
                      {fk.table}
                    </Button>
                    .{fk.to}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {schema.indexes.length > 0 && (
        <>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Indexes
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Unique</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schema.indexes.map((idx) => (
                <TableRow key={idx.name}>
                  <TableCell className="font-mono text-xs">
                    {idx.name}
                  </TableCell>
                  <TableCell className="text-xs">
                    {idx.unique ? (
                      <Badge variant="outline" className="text-[10px]">
                        UNIQUE
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
