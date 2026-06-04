"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { getQueues } from "@/lib/api-client";
import type { QueueStats } from "@promptqueue/core";
import { AlertCircle, Clock, Play, CheckCircle2, XCircle } from "lucide-react";

export default function QueuesPage() {
  const [queues, setQueues] = useState<QueueStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getQueues();
        setQueues(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load queues");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Queues</h1>
        <p className="text-muted-foreground">Per-queue statistics and depth</p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : queues.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No queues found
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {queues.map((q) => (
            <Card key={q.name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-mono">{q.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Pending</p>
                      <p className="text-lg font-bold">{q.pending}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">Running</p>
                      <p className="text-lg font-bold">{q.running}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Completed</p>
                      <p className="text-lg font-bold">{q.completed}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <div>
                      <p className="text-xs text-muted-foreground">Failed</p>
                      <p className="text-lg font-bold">{q.failed}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 border-t pt-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold">{q.total}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Queue Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : queues.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No queues found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Running</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Completion Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((q) => (
                  <TableRow key={q.name}>
                    <TableCell className="font-mono font-medium">{q.name}</TableCell>
                    <TableCell><Badge variant="outline">{q.pending}</Badge></TableCell>
                    <TableCell><Badge variant="default">{q.running}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{q.completed}</Badge></TableCell>
                    <TableCell><Badge variant="destructive">{q.failed}</Badge></TableCell>
                    <TableCell className="font-semibold">{q.total}</TableCell>
                    <TableCell>{q.total > 0 ? `${((q.completed / q.total) * 100).toFixed(1)}%` : "N/A"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
