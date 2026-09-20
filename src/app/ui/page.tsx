"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Plus, Upload, ArrowUpDown, SlidersHorizontal, MoreHorizontal } from "lucide-react"

/** Витрина компонентов в теме Attio.
 *  Нужна, чтобы видеть работу исполнителей глазами, а не по их отчётам.
 *  Каждая секция подписана замером, на который она опирается. */

function Section({
  title,
  measure,
  children,
}: {
  title: string
  measure: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b py-8">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{measure}</p>
      </div>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}

const DEALS = [
  {
    contact: "Анастасия Чеботарь",
    project: "Select",
    stage: "Квалификация",
    manager: "Ион Р.",
    source: "Instagram",
    budget: "€68 000",
    pay: "Ипотека",
    next: "24 сен",
    sla: "ok",
  },
  {
    contact: "Дмитрий Врабие",
    project: "Select · Next",
    stage: "Презентация",
    manager: "Марина К.",
    source: "Звонок",
    budget: "€92 000",
    pay: "Кэш",
    next: "22 сен",
    sla: "ok",
  },
  {
    contact: "Елена Дариенко",
    project: "Next",
    stage: "Первичный контакт",
    manager: "Ион Р.",
    source: "Форма сайта",
    budget: "€54 000",
    pay: "Рассрочка",
    next: "—",
    sla: "late",
  },
]

export default function UiPage() {
  return (
    <TooltipProvider>
      <div className="mx-auto max-w-6xl px-8 py-10">
        <header className="border-b pb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">
            Компоненты в теме Attio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CRM застройщика · значения замерены по 99 кадрам интерфейса Attio
          </p>
        </header>

        <Section title="Кнопки" measure="высота 28px, радиус 6px, синяя с тёмной рамкой #3561d0">
          <Button>
            <Plus />
            Новая сделка
          </Button>
          <Button variant="outline">
            <Upload />
            Импорт
          </Button>
          <Button variant="secondary">Вторичная</Button>
          <Button variant="ghost">Призрак</Button>
          <Button variant="destructive">Удалить</Button>
          <Button variant="outline" disabled>Недоступна</Button>
          <Button size="sm" variant="outline">
            <ArrowUpDown />
            Сортировка
          </Button>
          <Button size="sm" variant="outline">
            <SlidersHorizontal />
            Фильтр
          </Button>
          <Button size="icon" variant="ghost">
            <MoreHorizontal />
          </Button>
        </Section>

        <Section title="Поля ввода" measure="высота контрола 28px, рамка #edeef0">
          <div className="grid w-full max-w-md gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Имя контакта</Label>
              <Input id="name" placeholder="Анастасия Чеботарь" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stage">Этап</Label>
              <Select>
                <SelectTrigger id="stage">
                  <SelectValue placeholder="Выберите этап" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Первичный контакт</SelectItem>
                  <SelectItem value="qual">Квалификация</SelectItem>
                  <SelectItem value="demo">Презентация</SelectItem>
                  <SelectItem value="deposit">Аванс</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note">Примечание</Label>
              <Textarea id="note" placeholder="Интересует двушка с видом во двор" />
            </div>
            <div className="flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox defaultChecked /> Диаспора
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch defaultChecked /> SLA включён
              </label>
            </div>
            <RadioGroup defaultValue="cash" className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="cash" /> Кэш
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="mortgage" /> Ипотека
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="installment" /> Рассрочка
              </label>
            </RadioGroup>
          </div>
        </Section>

        <Section title="Чипы и метки" measure="теги воронки, источники, статусы SLA">
          <Badge>Аванс</Badge>
          <Badge variant="secondary">Select</Badge>
          <Badge variant="outline">Next</Badge>
          <Badge variant="destructive">SLA просрочен</Badge>
          <Avatar className="size-6">
            <AvatarFallback className="text-[11px]">ИР</AvatarFallback>
          </Avatar>
        </Section>

        <Section
          title="Таблица сделок"
          measure="строка 36px, шапка 39px, полная сетка с вертикальными линиями — главный табличный приём Attio"
        >
          <div className="w-full overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Проект</TableHead>
                  <TableHead>Этап</TableHead>
                  <TableHead>Ответственный</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Бюджет</TableHead>
                  <TableHead>Оплата</TableHead>
                  <TableHead>Следующий шаг</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEALS.map((d) => (
                  <TableRow key={d.contact}>
                    <TableCell className="font-medium">{d.contact}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{d.project}</Badge>
                    </TableCell>
                    <TableCell>{d.stage}</TableCell>
                    <TableCell>{d.manager}</TableCell>
                    <TableCell className="text-muted-foreground">{d.source}</TableCell>
                    <TableCell>{d.budget}</TableCell>
                    <TableCell>{d.pay}</TableCell>
                    <TableCell
                      className={d.sla === "late" ? "text-destructive" : undefined}
                    >
                      {d.next}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section title="Вкладки" measure="вкладки карточки записи: Обзор, Активность, Задачи">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="activity">Активность</TabsTrigger>
              <TabsTrigger value="tasks">Задачи</TabsTrigger>
              <TabsTrigger value="calls">Звонки</TabsTrigger>
            </TabsList>
          </Tabs>
        </Section>

        <Section
          title="Всплывающие поверхности"
          measure="мягкая тень Attio: чёрный на 1–7%, тень расходится, но не темнеет"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Действия</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>Назначить ответственного</DropdownMenuItem>
              <DropdownMenuItem>Объединить с дублем</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Закрыть как проигранную</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Поповер</Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm">
              Перенести сделку дальше нельзя, пока не назначена дата следующего шага.
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Подсказка</Button>
            </TooltipTrigger>
            <TooltipContent>Первый ответ: 14 минут</TooltipContent>
          </Tooltip>

          <Dialog>
            <DialogTrigger asChild>
              <Button>Диалог</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Найден дубль по номеру</DialogTitle>
                <DialogDescription>
                  Номер +373 69 118 240 уже есть в сделке «Дмитрий Врабие».
                  Объединить карточки с сохранением истории обеих?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Отмена</Button>
                <Button>Объединить</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Section title="Контейнеры и индикаторы" measure="карточка держится рамкой, а не тенью">
          <Card className="w-72">
            <CardHeader>
              <CardTitle className="text-sm">Конверсия за сентябрь</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={38} />
              <p className="text-[13px] text-muted-foreground">
                38% лидов дошли до презентации
              </p>
              <Separator />
              <Slider defaultValue={[60]} max={100} />
            </CardContent>
          </Card>

          <Alert className="w-80">
            <AlertTitle>SLA нарушен</AlertTitle>
            <AlertDescription>
              Три лида без первого ответа дольше 15 минут.
            </AlertDescription>
          </Alert>

          <div className="w-52 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Section>
      </div>
    </TooltipProvider>
  )
}
