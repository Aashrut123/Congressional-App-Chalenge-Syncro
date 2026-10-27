# Syncro

Syncro is a shared planner for a student team. You and your teammates keep one calendar, one task list, and one place to say what got done, instead of scattering it across texts.

## A normal day

You open the app and it says what to work on next. Overdue work sits at the top. The rest of the home screen shows what is coming up, your projects, and a short note if someone posted an update.

There are four tabs: Home, Tasks, Projects, and Calendar.

## Projects

A project is the group you are working with. The person who creates it is the owner. They can invite teammates with a code. Everyone on the project can see the same tasks, meetings, and progress.

The owner can archive a project or delete it. Deleting a project removes its tasks and meetings too, and the app asks first.

## Tasks

A task has a title, a due date, and a status: not started, in progress, blocked, or finished. You can assign it to a teammate, attach it to a milestone, and leave a comment when something changes.

Tasks can repeat. Skipping one date leaves the rest of the series alone. Any member of the project can delete a shared task. A personal task stays with the person who made it.

If a task is overdue and you have weekly hours saved, Syncro moves it into the next open block on your own schedule. It does not invent a time.

## Calendar and meetings

The calendar shows meetings, deadlines, and task due dates. You can look at a month, a week, or a single day.

A meeting belongs to a project. Any member can move it or delete it. When someone changes the time, the other people on that project get a notice that says the meeting moved. The person who made the change does not get that notice.

Phone alerts, turned on from Profile, remind you about an hour before a task is due and about 30 minutes before a meeting starts.

## Hours

Each person can save the hours they are usually free, and the days they are away. Syncro uses those hours when it looks for a meeting time that works for more than one person, and when it slides an overdue task forward.

## The assistant

The chat on the home screen goes to Gemini. It can see your projects, open tasks, upcoming meetings, and saved hours.

If you ask it to move a meeting or a task, it suggests a specific day and time and waits. Nothing is saved until you tap Confirm. A question that is not a calendar change just gets an answer.

## Plans and updates

You can ask Syncro to draft a plan for a new project, or to revise one you already have. You read the draft before anything is saved.

A progress log is a short note about what actually got finished. Teammates can read it on the project.

## Run it

The app lives in the `GroupSync` folder. You need Node.js 22 or later, a Supabase project, and the Expo Go app on your phone.

```sh
cd GroupSync
npm install
```

Copy `GroupSync/.env.example` to `GroupSync/.env` and fill in your Supabase URL and publishable key. In the Supabase SQL editor, run the files in `GroupSync/supabase/migrations/` in order. Then:

```sh
npm start
```

Scan the QR code with Expo Go. If your phone cannot see the computer, use `npm start -- --tunnel`.
