# UI Components Documentation

**Project:** Doctor Dashboard - Clinical Intelligence System  
**Version:** 3.0.0  
**Last Updated:** 2026-05-13

---

## Table of Contents

1. [Component Overview](#component-overview)
2. [Component Structure](#component-structure)
3. [UI Component Library](#ui-component-library)
4. [Dashboard Components](#dashboard-components)
5. [Page Components](#page-components)
6. [Component Usage Guidelines](#component-usage-guidelines)
7. [Styling and Theming](#styling-and-theming)
8. [Component Examples](#component-examples)

---

## Component Overview

### Component Architecture

The Doctor Dashboard follows a **hierarchical component structure**:

```
App
├── Pages (Layout & Routing)
│   ├── Index (Dashboard)
│   ├── UploadCenter
│   ├── Login
│   └── Settings
├── UI Components (Reusable)
│   ├── Cards (Dashboard Cards)
│   ├── Forms (Input Components)
│   ├── Feedback (Notifications)
│   └── Layout (Containers)
└── Feature Components
    ├── Chat Panel
    ├── Document Viewer
    └── Analytics Overview
```

### Design Principles

1. **Composition over Inheritance** - Small, focused components
2. **Reusable Patterns** - Consistent UI elements across application
3. **Accessibility First** - WCAG AA compliant components
4. **Performance Optimized** - Lazy loading and code splitting
5. **Type Safety** - Full TypeScript support

---

## Component Structure

### File Organization

```
src/components/
├── ui/                    # Reusable UI components
│   ├── alerts.tsx
│   ├── badges.tsx
│   ├── buttons.tsx
│   ├── cards.tsx
│   ├── forms.tsx
│   ├── modals.tsx
│   └── navigation.tsx
├── dashboard/             # Dashboard-specific components
│   ├── cards/
│   │   ├── MedicationCard.tsx
│   │   ├── VitalsCard.tsx
│   │   ├── LabsCard.tsx
│   │   └── SummaryCard.tsx
│   ├── charts/
│   ├── tables/
│   └── timelines/
├── chat/                  # Chat components
│   ├── ChatPanel.tsx
│   ├── MessageList.tsx
│   └── InputArea.tsx
├── upload/                # Upload components
│   ├── FileUploader.tsx
│   ├── ProgressIndicator.tsx
│   └── DocumentPreview.tsx
└── shared/                # Shared utilities
    ├── ErrorBoundary.tsx
    ├── LoadingSpinner.tsx
    └── EmptyState.tsx
```

### Component Naming Conventions

- **PascalCase** for component names: `MedicationCard.tsx`
- **Descriptive names** that indicate purpose: `PatientDemographicsForm.tsx`
- **Group related components** in subdirectories

---

## UI Component Library

### Base UI Components

Built on **Radix UI** primitives with **Tailwind CSS** styling:

#### Alert Components

```typescript
/**
 * Alert dialog for critical confirmations
 * @param title - Alert title text
 * @param description - Detailed alert description
 * @param onConfirm - Confirmation callback
 * @param onCancel - Cancellation callback
 */
<AlertDialog>
  <AlertDialogTrigger>
    <Button variant="destructive">Delete Document</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onConfirm}>
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

#### Button Components

```typescript
/**
 * Variants: default, destructive, outline, secondary, ghost, link
 * Sizes: default, sm, lg, icon
 */
<Button variant="default" size="lg">
  Process Document
</Button>

<Button variant="outline" size="sm">
  Cancel
</Button>

<Button variant="ghost" onClick={onAction}>
  <Icon name="edit" className="mr-2 h-4 w-4" />
  Edit
</Button>
```

#### Card Components

```typescript
/**
 * Container component for grouping related content
 */
<Card>
  <CardHeader>
    <CardTitle>Patient Information</CardTitle>
    <CardDescription>Demographics and contact details</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Main content */}
  </CardContent>
  <CardFooter>
    <Button>Save Changes</Button>
  </CardFooter>
</Card>
```

#### Form Components

```typescript
/**
 * Input components with validation
 */
<FormField>
  <FormLabel>Medication Name</FormLabel>
  <FormControl>
    <Input 
      type="text" 
      placeholder="Enter medication name"
      value={medication.name}
      onChange={(e) => setMedication({...medication, name: e.target.value})}
    />
  </FormControl>
  <FormDescription>
    Enter the generic or brand name
  </FormDescription>
  <FormMessage />
</FormField>

/**
 * Select dropdown
 */
<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Select department" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="cardiology">Cardiology</SelectItem>
    <SelectItem value="neurology">Neurology</SelectItem>
    <SelectItem value="oncology">Oncology</SelectItem>
  </SelectContent>
</Select>
```

#### Modal/Dialog Components

```typescript
/**
 * Modal dialog for focused user interactions
 */
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="sm:max-w-[425px]">
    <DialogHeader>
      <DialogTitle>Edit Patient Details</DialogTitle>
      <DialogDescription>
        Make changes to patient information here.
      </DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 py-4">
      {/* Form content */}
    </div>
    <DialogFooter>
      <Button type="submit">Save changes</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Dashboard Components

### Dashboard Card System

#### MedicationCard

```typescript
/**
 * Displays active patient medications with dosage and frequency
 * @props medications - Array of medication objects
 * @props onEdit - Edit callback
 * @props className - Additional styling classes
 */

interface MedicationProps {
  medications: Medication[];
  onEdit?: (medication: Medication) => void;
  className?: string;
}

// Usage
<MedicationCard 
  medications={[
    {
      name: 'Aspirin',
      dosage: '100mg',
      frequency: 'daily',
      status: 'active'
    }
  ]}
  onEdit={(med) => openEditModal(med)}
/>
```

#### VitalsCard

```typescript
/**
 * Displays patient vital signs with trend indicators
 * @props vitals - Vitals data object
 * @props showTrends - Display trend arrows
 * @props thresholdConfig - Custom warning thresholds
 */

interface VitalsProps {
  vitals: VitalsData;
  showTrends?: boolean;
  thresholdConfig?: ThresholdConfig;
}

// Usage
<VitalsCard 
  vitals={{
    bloodPressure: { systolic: 120, diastolic: 80 },
    heartRate: 72,
    temperature: 98.6,
    respiratoryRate: 16
  }}
  showTrends={true}
/>
```

#### LabsCard

```typescript
/**
 * Displays laboratory test results with abnormal value highlighting
 * @props labs - Array of lab results
 * @props groupByCategory - Group results by category
 * @props onAbnormalClick - Click handler for abnormal values
 */

interface LabsProps {
  labs: LabResult[];
  groupByCategory?: boolean;
  onAbnormalClick?: (lab: LabResult) => void;
}

// Usage
<LabsCard 
  labs={labResults}
  groupByCategory={true}
  onAbnormalClick={(lab) => showDetails(lab)}
/>
```

#### SummaryCard

```typescript
/**
 * Overview card with key patient information
 * @props patient - Patient demographics object
 * @props admissionDate - Hospital admission date
 * @props primaryDiagnosis - Main diagnosis
 */

interface SummaryProps {
  patient: PatientDemographics;
  admissionDate: Date;
  primaryDiagnosis: string;
}

// Usage
<SummaryCard 
  patient={patientData}
  admissionDate={admissionDate}
  primaryDiagnosis="Community-acquired pneumonia"
/>
```

### Data Visualization Components

#### TimelineChart

```typescript
/**
 * Displays events over time (vitals, labs, medications)
 * @props events - Array of timestamped events
 * @props eventType - Type of events to display
 * @props onEventClick - Click handler for events
 */

interface TimelineProps {
  events: TimelineEvent[];
  eventType: 'vitals' | 'labs' | 'medications';
  onEventClick?: (event: TimelineEvent) => void;
}

// Usage
<TimelineChart 
  events={vitalsHistory}
  eventType="vitals"
  onEventClick={(event) => showEventDetails(event)}
/>
```

#### DataTable

```typescript
/**
 * Sortable, filterable data table with pagination
 * @props columns - Column definitions
 * @props data - Table data array
 * @props sortable - Enable sorting
 * @props filterable - Enable filtering
 */

interface TableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  sortable?: boolean;
  filterable?: boolean;
  pageSize?: number;
}

// Usage
<DataTable 
  columns={[
    { header: 'Medication', accessorKey: 'name' },
    { header: 'Dosage', accessorKey: 'dosage' },
    { header: 'Frequency', accessorKey: 'frequency' }
  ]}
  data={medications}
  sortable={true}
/>
```

---

## Page Components

### Index (Dashboard Page)

```typescript
/**
 * Main dashboard page with patient overview
 * @props documentId - Current document ID
 * @props documentData - Processed document data
 */

// Main structure
<div className="dashboard-container">
  <Header />
  <div className="dashboard-grid">
    <SummaryCard />
    <MedicationCard />
    <VitalsCard />
    <LabsCard />
    <TimelineChart />
  </div>
  <ChatPanel />
</div>
```

### UploadCenter

```typescript
/**
 * File upload and processing interface
 * @props onUpload - Upload callback
 * @props processingStatus - Current processing status
 */

// Components
<FileUploader 
  accept=".pdf"
  maxSize={25 * 1024 * 1024}
  onUpload={handleFileUpload}
/>

<ProgressIndicator 
  status={processingStatus}
  currentStep={currentStep}
  totalSteps={totalSteps}
/>

<DocumentPreview 
  document={uploadedDocument}
  extractedData={processedData}
/>
```

### Login Page

```typescript
/**
 * Authentication interface
 * @props onLogin - Login callback
 * @props error - Authentication error message
 */

<LoginForm 
  onSubmit={(credentials) => authenticate(credentials)}
  error={authError}
/>

<PasswordResetRequest 
  onSuccess={() => showMessage('Reset email sent')}
/>
```

---

## Component Usage Guidelines

### Best Practices

#### 1. Component Composition

```typescript
// Good: Compose small, focused components
<div className="medication-card">
  <MedicationHeader medication={med} />
  <MedicationDetails medication={med} />
  <MedicationActions onEdit={onEdit} onDelete={onDelete} />
</div>

// Avoid: Large monolithic components
<div className="medication-card">
  {/* 500 lines of JSX */}
</div>
```

#### 2. Props Design

```typescript
// Good: Descriptive, typed props
interface MedicationCardProps {
  medications: Medication[];
  onEdit?: (medication: Medication) => void;
  className?: string;
  showTrends?: boolean;
}

// Avoid: Vague prop names
interface Props {
  data: any;
  callback: Function;
  flag?: boolean;
}
```

#### 3. State Management

```typescript
// Good: Local state for component-specific data
const [isEditing, setIsEditing] = useState(false);
const [editValue, setEditValue] = useState(initialValue);

// Complex state: Use useReducer
const [formState, dispatch] = useReducer(formReducer, initialState);

// Shared state: Use context or store
const { medications } = useMedicationStore();
```

#### 4. Error Handling

```typescript
// Good: Graceful error boundaries
<ErrorBoundary fallback={<ErrorMessage />}>
  <MedicationCard medications={medications} />
</ErrorBoundary>

// Component-level error handling
const MedicationCard = ({ medications }) => {
  if (!medications || medications.length === 0) {
    return <EmptyState message="No medications found" />;
  }
  
  // Render content
};
```

### Performance Guidelines

#### Memoization

```typescript
// Memoize expensive calculations
const sortedMedications = useMemo(() => {
  return medications.sort((a, b) => a.name.localeCompare(b.name));
}, [medications]);

// Memoize callbacks
const handleEdit = useCallback((medication) => {
  onEdit(medication);
}, [onEdit]);

// Memoize components
const ExpensiveChart = React.memo(({ data }) => {
  // Complex rendering logic
});
```

#### Code Splitting

```typescript
// Lazy load heavy components
const ChartLibrary = React.lazy(() => import('./ChartLibrary'));

// Usage with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <ChartLibrary data={chartData} />
</Suspense>
```

---

## Styling and Theming

### Tailwind CSS Configuration

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          700: '#0369a1',
        },
        medical: {
          blue: '#0066cc',
          green: '#52c41a',
          red: '#ff4d4f',
          orange: '#fa8c16',
        }
      }
    }
  }
};
```

### Component Styling Patterns

```typescript
// Consistent styling utilities
<div className="
  rounded-lg 
  border 
  border-gray-200 
  bg-white 
  p-6 
  shadow-sm
  hover:shadow-md 
  transition-shadow
">
  {/* Content */}
</div>

// Responsive design
<div className="
  grid 
  grid-cols-1 
  md:grid-cols-2 
  lg:grid-cols-3 
  gap-4
">
  {/* Responsive grid */}
</div>
```

### Dark Mode Support

```typescript
// Dark mode implementation
const { theme } = useTheme();

<div className={`
  bg-white dark:bg-gray-900
  text-gray-900 dark:text-gray-100
  border-gray-200 dark:border-gray-700
`}>
  {/* Theme-aware content */}
</div>
```

---

## Component Examples

### Complete Card Component Example

```typescript
/**
 * MedicationCard - Displays patient medications with actions
 */
interface MedicationCardProps {
  medications: Medication[];
  onEdit?: (medication: Medication) => void;
  onDelete?: (medication: Medication) => void;
  className?: string;
}

const MedicationCard: React.FC<MedicationCardProps> = ({
  medications,
  onEdit,
  onDelete,
  className = ''
}) => {
  if (!medications || medications.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="py-8">
          <EmptyState 
            icon="pill"
            message="No active medications"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Active Medications</CardTitle>
        <CardDescription>
          {medications.length} current medications
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {medications.map((medication) => (
            <div 
              key={medication.id}
              className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
            >
              <div className="flex-1">
                <h4 className="font-semibold">{medication.name}</h4>
                <p className="text-sm text-gray-600">
                  {medication.dosage} - {medication.frequency}
                </p>
              </div>
              <div className="flex gap-2">
                {onEdit && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => onEdit(medication)}
                  >
                    Edit
                  </Button>
                )}
                {onDelete && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => onDelete(medication)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
```

### Form Component Example

```typescript
/**
 * PatientDemographicsForm - Form for editing patient information
 */
const PatientDemographicsForm = () => {
  const { patient, updatePatient } = usePatientStore();
  const [formData, setFormData] = useState(patient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updatePatient(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField>
        <FormLabel>Patient Name</FormLabel>
        <FormControl>
          <Input 
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            placeholder="Enter patient name"
          />
        </FormControl>
      </FormField>

      <FormField>
        <FormLabel>Date of Birth</FormLabel>
        <FormControl>
          <Input 
            type="date"
            value={formData.dateOfBirth}
            onChange={(e) => setFormData({...formData, dateOfBirth: e.target.value})}
          />
        </FormControl>
      </FormField>

      <FormField>
        <FormLabel>Gender</FormLabel>
        <Select 
          value={formData.gender}
          onValueChange={(value) => setFormData({...formData, gender: value})}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <Button type="submit">Save Changes</Button>
    </form>
  );
};
```

---

## Accessibility Guidelines

### WCAG Compliance

```typescript
// Keyboard navigation
<button 
  onClick={handleAction}
  onKeyDown={(e) => e.key === 'Enter' && handleAction()}
  aria-label="Edit medication"
>
  <EditIcon />
</button>

// Screen reader support
<div role="alert" aria-live="polite">
  {errorMessage}
</div>

// Focus management
<dialog 
  ref={dialogRef}
  onClose={handleClose}
  aria-labelledby="dialog-title"
>
  <h2 id="dialog-title">Edit Patient</h2>
  {/* Form content */}
</dialog>
```

---

## Additional Resources

### Internal Documentation
- [Development Workflow](DEVELOPMENT_WORKFLOW.md)
- [Testing Guide](TESTING.md)
- [Architecture Documentation](architecture/)

### External Resources
- [Radix UI Documentation](https://www.radix-ui.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [React Accessibility](https://react.dev/reference/react-dom)
- [TypeScript React Patterns](https://react-typescript-cheatsheet.netlify.app/)

---

**Last Updated:** 2026-05-13  
**Maintained by:** Frontend Team  
**Questions?** Contact the development team or create an issue in the repository.