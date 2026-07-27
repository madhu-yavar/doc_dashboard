# Frontend Tasks & Subtasks Breakdown

## Phase 6: Frontend Components (Enhanced with Paper & AI)

### Task 6.1: Main Journey Page
**File**: `src/pages/InpatientJourney.tsx`

#### Subtasks:
- [ ] Create main journey page structure
- [ ] Implement routing and parameter handling:
  - [ ] Handle journey ID from URL params
  - [ ] Handle patient ID routing
  - [ ] Implement navigation between journeys
- [ ] Page layout and design:
  - [ ] Create responsive layout
  - [ ] Add loading states and skeletons
  - [ ] Add error handling and display
- [ ] Data fetching and state management:
  - [ ] Fetch journey data by ID
  - [ ] Fetch patient information
  - [ ] Implement caching and refetching
  - [ ] Handle real-time updates
- [ ] Integration with child components:
  - [ ] Integrate JourneyHeader component
  - [ ] Integrate DailyNotesTimeline component
  - [ ] Integrate DepartmentIntegrations component
  - [ ] Integrate JourneyAnalytics component
- [ ] Permission and access control:
  - [ ] Implement role-based UI
  - [ ] Handle read-only vs edit permissions
- [ ] Mobile responsiveness:
  - [ ] Optimize for mobile devices
  - [ ] Add mobile-specific navigation
  - [ ] Touch-friendly interactions

### Task 6.2: Journey Header Component
**File**: `src/components/journey/JourneyHeader.tsx`

#### Subtasks:
- [ ] Create journey overview header component
- [ ] Patient information display:
  - [ ] Show patient basic info (name, age, gender)
  - [ ] Display patient photo if available
  - [ ] Show admission date and time
  - [ ] Display current location/bed
  - [ ] Show attending physician
- [ ] Journey status display:
  - [ ] Current journey status badge
  - [ ] Length of stay calculation
  - [ ] Journey progress indicator
  - [ ] Discharge date (if applicable)
- [ ] Journey actions:
  - [ ] Quick action buttons (edit, transfer, discharge)
  - [ ] Action modals and forms
  - [ ] Permission-based action display
- [ ] Integration with existing PatientHeader patterns:
  - [ ] Reuse existing patient header styles
  - [ ] Maintain consistent styling
  - [ ] Follow established patterns
- [ ] Responsive design:
  - [ ] Desktop layout optimization
  - [ ] Mobile layout adaptation
  - [ ] Responsive information density

### Task 6.3: Daily Notes Timeline Component
**File**: `src/components/journey/DailyNotesTimeline.tsx`

#### Subtasks:
- [ ] Create timeline view component
- [ ] Timeline structure:
  - [ ] Create chronological timeline layout
  - [ ] Add date grouping and headers
  - [ ] Show note creation times
  - [ ] Implement time-based navigation
- [ ] Note card design:
  - [ ] Create note card component
  - [ ] Display note summary preview
  - [ ] Show note source badges (manual/voice/paper)
  - [ ] Display verification status for paper notes
  - [ ] Show note author and timestamp
- [ ] Note filtering and sorting:
  - [ ] Filter by note type
  - [ ] Filter by note source (manual/voice/paper)
  - [ ] Filter by verification status
  - [ ] Sort by date and relevance
- [ ] Note interaction:
  - [ ] Click to view full note
  - [ ] Edit note functionality
  - [ ] Delete note with confirmation
  - [ ] Voice/audio playback for voice notes
  - [ ] View original paper image for paper notes
- [ ] Digitization progress tracking:
  - [ ] Show digitization progress bar
  - [ ] Display note source statistics
  - [ ] Highlight unverified paper notes
- [ ] Performance optimization:
  - [ ] Implement virtual scrolling for long timelines
  - [ ] Lazy load note content
  - [ ] Optimize rendering performance

### Task 6.4: Daily Note Editor Component
**File**: `src/components/journey/DailyNoteEditor.tsx`

#### Subtasks:
- [ ] Create note editing interface
- [ ] Editor modes:
  - [ ] Create new note mode
  - [ ] Edit existing note mode
  - [ ] View only mode
- [ ] Manual note editing:
  - [ ] Rich text editor integration
  - [ ] SOAP section structure
  - [ ] Medical terminology support
  - [ ] Auto-save functionality
  - [ ] Version history
- [ ] Form fields and validation:
  - [ ] Note type selection
  - [ ] Date and time picker
  - [ ] Required field validation
  - [ ] Medical content validation
- [ ] Input method selection:
  - [ ] Manual entry tab
  - [ ] Voice capture tab
  - [ ] Paper capture tab
  - [ ] Method switching and conversion
- [ ] Review and approval actions:
  - [ ] Submit for review button
  - [ ] Save draft functionality
  - [ ] Preview before submit
  - [ ] Approval workflow display
- [ ] Accessibility and usability:
  - [ ] Keyboard shortcuts
  - [ ] Screen reader support
  - [ ] High contrast mode support

### Task 6.5: Voice Daily Note Capture Component
**File**: `src/components/journey/VoiceDailyNoteCapture.tsx`

#### Subtasks:
- [ ] Create voice capture interface
- [ ] Real-time voice recording:
  - [ ] Start/stop recording controls
  - [ ] Live audio visualization
  - [ ] Recording duration timer
  - [ ] Audio level monitoring
- [ ] Real-time transcription display:
  - [ ] Show live transcript
  - [ ] Display confidence scores
  - [ ] Highlight medical terminology
  - [ ] SOAP structure detection display
- [ ] Recording management:
  - [ ] Pause/resume functionality
  - [ ] Cancel and redo options
  - [ ] Audio preview playback
  - [ ] Multiple recording segments
- [ ] Integration with voice processing:
  - [ ] WebSocket connection for real-time processing
  - [ ] Handle connection errors
  - [ ] Progress indicators
  - [ ] Processing completion notification
- [ ] Review and edit:
  - [ ] Review extracted transcript
  - [ ] Edit extracted content
  - [ ] Add manual corrections
  - [ ] Finalize note creation
- [ ] User guidance:
  - [ ] Recording tips and best practices
  - [ ] Medical dictation guidance
  - [ ] Error messages and help

### Task 6.6: Paper Note Capture Component (Mobile-First)
**File**: `src/components/journey/PaperNoteCapture.tsx`

#### Subtasks:
- [ ] Create mobile-optimized photo capture interface
- [ ] Camera integration:
  - [ ] Access device camera
  - [ ] Camera controls (flash, focus, zoom)
  - [ ] Live camera preview
  - [ ] Photo capture button
  - [ ] Multiple photo capture support
- [ ] Image preview and review:
  - [ ] Show captured photo preview
  - [ ] Retake functionality
  - [ ] Crop and rotate tools
  - [ ] Quality enhancement options
  - [ ] Multi-photo review
- [ ] Journey and date association:
  - [ ] Quick journey selection
  - [ ] Date picker for note date
  - [ ] Note type selection
  - [ ] Patient identification verification
- [ ] Upload and processing:
  - [ ] Upload progress indicator
  - [ ] Processing status display
  - [ ] Extraction progress tracking
  - [ ] Success/error notifications
- [ ] Voice annotation during capture:
  - [ ] Add voice note while capturing
  - [ ] Quick voice annotation recording
  - [ ] Link voice to paper note
- [ ] Offline support:
  - [ ] Offline photo capture
  - [ ] Queue uploads when offline
  - [ ] Sync when connection restored
  - [ ] Offline queue management
- [ ] Mobile optimization:
  - [ ] Touch-friendly interface
  - [ ] Responsive design for phones/tablets
  - [ ] Performance optimization for mobile devices
  - [ ] Battery considerations

### Task 6.7: Batch Paper Upload Component
**File**: `src/components/journey/BatchPaperUpload.tsx`

#### Subtasks:
- [ ] Create batch scanning interface
- [ ] File upload interface:
  - [ ] Drag and drop file upload
  - [ ] File browser selection
  - [ ] Multiple file selection
  - [ ] File type validation (images, PDFs)
- [ ] Batch processing display:
  - [ ] Show upload queue
  - [ ] Individual file progress
  - [ ] Batch processing status
  - [ ] Overall progress indicator
- [ ] File preview and management:
  - [ ] Preview each uploaded file
  - [ ] Remove files from queue
  - [ ] Reorder files in queue
  - [ ] File information display
- [ ] Patient and journey matching:
  - [ ] Patient selection/upload info
  - [ ] Automatic journey matching
  - [ ] Manual journey assignment
  - [ ] Bulk journey assignment
- [ ] Processing options:
  - [ ] Processing priority selection
  - [ ] Extraction options
  - [ ] Verification queue options
- [ ] Upload management:
  - [ ] Pause/resume uploads
  - [ ] Cancel uploads
  - [ ] Retry failed uploads
  - [ ] Upload history
- [ ] Performance considerations:
  - [ ] Chunked file upload
  - [ ] Memory management
  - [ ] Progress optimization

### Task 6.8: Extracted Content Review Component (Human Verification)
**File**: `src/components/journey/ExtractedContentReview.tsx`

#### Subtasks:
- [ ] Create human verification interface
- [ ] Side-by-side review layout:
  - [ ] Original paper image display
  - [ ] Extracted content display
  - [ ] Synchronized scrolling
  - [ ] Zoom and pan controls
- [ ] Extracted content editing:
  - [ ] Editable extracted text fields
  - [ ] Field-by-field validation
  - [ ] Medical content validation
  - [ ] Auto-correction suggestions
- [ ] Confidence visualization:
  - [ ] Highlight low-confidence sections
  - [ ] Show AI confidence scores
  - [ ] Uncertainty indicators
  - [ ] Suggested corrections
- [ ] Verification actions:
  - [ ] Approve individual sections
  - [ ] Reject individual sections
  - [ ] Approve entire note
  - [ ] Reject entire note
  - [ ] Request re-extraction
- [ ] Verification workflow:
  - [ ] Skip and queue for later
  - [ ] Batch verification mode
  - [ ] Verification progress tracking
  - [ ] Verification queue navigation
- [ ] Quality and feedback:
  - [ ] Report extraction errors
  - [ ] Provide correction feedback
  - [ ] Flag problematic sections
  - [ ] Verification notes
- [ ] Audit trail:
  - [ ] Track verification history
  - [ ] Show verifier information
  - [ ] Display verification timestamps
- [ ] Performance optimization:
  - [ ] Lazy loading of high-resolution images
  - [ ] Optimized image rendering
  - [ ] Efficient state management

### Task 6.9: Department Integrations Component
**File**: `src/components/journey/DepartmentIntegrations.tsx`

#### Subtasks:
- [ ] Create department integration status dashboard
- [ ] Integration overview:
  - [ ] Integration summary cards
  - [ ] Status indicators (pending/processing/completed/failed)
  - [ ] Integration type grouping
  - [ ] Timeline view of integrations
- [ ] Lab integrations section:
  - [ ] List lab orders and results
  - [ ] Show order status and dates
  - [ ] Display critical results prominently
  - [ ] Link to daily notes
- [ ] Radiology integrations section:
  - [ ] List radiology orders and reports
  - [ ] Show imaging status and dates
  - [ ] Display report availability
  - [ ] Link to daily notes
- [ ] Pharmacy integrations section:
  - [ ] List medication orders
  - [ ] Show order fulfillment status
  - [ ] Display medication information
- [ ] Integration actions:
  - [ ] Create new orders
  - [ ] View integration details
  - [ ] Retry failed integrations
  - [ ] Export pending orders
- [ ] Filtering and search:
  - [ ] Filter by integration type
  - [ ] Filter by status
  - [ ] Search by test/order name
  - [ ] Date range filtering
- [ ] Real-time updates:
  - [ ] Auto-refresh integration status
  - [ ] Real-time status updates
  - [ ] New result notifications

### Task 6.10: Journey Analytics Component
**File**: `src/components/journey/JourneyAnalytics.tsx`

#### Subtasks:
- [ ] Create journey analytics and insights display
- [ ] Journey statistics:
  - [ ] Length of stay analysis
  - [ ] Daily note frequency
  - [ ] Department integration volume
  - [ ] Digitization progress metrics
- [ ] Visualizations:
  - [ ] Timeline charts for progress
  - [ ] Daily note trends
  - [ ] Department integration patterns
  - [ ] Digitization progress charts
- [ ] Quality metrics:
  - [ ] Note completion rates
  - [ ] Verification statistics
  - [ ] Integration success rates
  - [ ] Response time metrics
- [ ] Insights and alerts:
  - [ ] Missing note alerts
  - [ ] Integration failure alerts
  - [ ] Digitization gap warnings
  - [ ] Progress indicators
- [ ] Data export:
  - [ ] Export journey summary
  - [ ] Export analytics data
  - [ ] Generate reports
- [ ] Interactive features:
  - [ ] Filter by date ranges
  - [ ] Drill-down into details
  - [ ] Compare metrics

## Frontend Infrastructure Tasks

### Task 6.11: State Management & Data Layer
#### Subtasks:
- [ ] Set up React Query for data fetching:
  - [ ] Create journey queries
  - [ ] Create daily notes queries
  - [ ] Create department integration queries
  - [ ] Implement caching strategy
- [ ] Create API client functions:
  - [ ] Journey API calls
  - [ ] Daily notes API calls
  - [ ] Department integration API calls
  - [ ] Paper digitization API calls
- [ ] Error handling and retry logic:
  - [ ] Global error handling
  - [ ] Automatic retry strategy
  - [ ] User-friendly error messages
- [ ] Real-time updates:
  - [ ] WebSocket integration for voice
  - [ ] Real-time journey status updates
  - [ ] Live transcript updates

### Task 6.12: UI/UX Design System
#### Subtasks:
- [ ] Create journey-specific design tokens:
  - [ ] Color schemes for different note sources
  - [ ] Status badge colors
  - [ ] Typography hierarchy
- [ ] Reusable UI components:
  - [ ] Note card component
  - [ ] Status badge component
  - [ ] Timeline component
  - [ ] Upload zone component
- [ ] Animation and transitions:
  - [ ] Loading animations
  - [ ] Page transitions
  - [ ] Micro-interactions
- [ ] Accessibility:
  - [ ] Keyboard navigation
  - [ ] Screen reader support
  - [ ] Focus management
  - [ ] Color contrast compliance

### Task 6.13: Mobile Responsive Design
#### Subtasks:
- [ ] Mobile-specific layouts:
  - [ ] Single column layout for phones
  - [ ] Optimized table layouts
  - [ ] Mobile navigation
  - [ ] Touch-optimized controls
- [ ] Progressive enhancement:
  - [ ] Feature detection
  - [ ] Graceful degradation
  - [ ] Mobile-first approach
- [ ] Performance optimization:
  - [ ] Image optimization for mobile
  - [ ] Lazy loading
  - [ ] Reduced animation on low-end devices

### Task 6.14: File Upload & Media Handling
#### Subtasks:
- [ ] Audio file handling:
  - [ ] Audio file upload component
  - [ ] Audio recording functionality
  - [ ] Audio playback controls
  - [ ] File size and format validation
- [ ] Image file handling:
  - [ ] Image upload component
  - [ ] Camera integration
  - [ ] Image preview
  - [ ] Image compression
  - [ ] File validation
- [ ] Batch upload handling:
  - [ ] Drag and drop interface
  - [ ] Progress tracking
  - [ ] Error handling
  - [ ] Queue management

### Task 6.15: Testing & Quality Assurance
#### Subtasks:
- [ ] Component unit testing:
  - [ ] Test individual components
  - [ ] Test state management
  - [ ] Test user interactions
- [ ] Integration testing:
  - [ ] Test API integration
  - [ ] Test data flow
  - [ ] Test real-time features
- [ ] End-to-end testing:
  - [ ] Test complete user workflows
  - [ ] Test error scenarios
  - [ ] Test edge cases
- [ ] Accessibility testing:
  - [ ] Screen reader testing
  - [ ] Keyboard navigation testing
  - [ ] Color contrast testing
- [ ] Performance testing:
  - [ ] Load testing
  - [ ] Rendering performance
  - [ ] Memory leak detection

### Task 6.16: Documentation & Developer Experience
#### Subtasks:
- [ ] Component documentation:
  - [ ] Document component props
  - [ ] Document usage examples
  - [ ] Document design patterns
- [ ] Storybook integration:
  - [ ] Create component stories
  - [ ] Document component variants
  - [ ] Interactive component documentation
- [ ] Developer tools:
  - [ ] Debug components
  - [ ] Performance monitoring
  - [ ] Error tracking integration

## Frontend Integration Tasks

### Task: Cross-Component Integration
#### Subtasks:
- [ ] Integrate all journey page components
- [ ] Test data flow between components
- [ ] Implement shared state management
- [ ] Test component communication
- [ ] Optimize component rendering

### Task: Real-time Features Integration
#### Subtasks:
- [ ] Integrate WebSocket for voice capture
- [ ] Implement real-time journey updates
- [ ] Add live transcript streaming
- [ ] Handle connection errors gracefully
- [ ] Test real-time features thoroughly

### Task: Mobile Feature Integration
#### Subtasks:
- [ ] Integrate camera access for paper capture
- [ ] Implement offline data capture
- [ ] Add sync when connection restored
- [ ] Optimize mobile performance
- [ ] Test on various mobile devices

### Task: Accessibility & Compliance
#### Subtasks:
- [ ] Ensure WCAG AA compliance
- [ ] Implement proper ARIA labels
- [ ] Test with screen readers
- [ ] Ensure keyboard navigation
- [ ] Test high contrast mode
- [ ] Implement proper focus management