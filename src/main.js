import './style.css'
import Chart from 'chart.js/auto'
import { supabase } from './supabase.js'
import { renderAdminPanel } from './admin.js'
import {
  captureCommentDrafts,
  createCommentsSection,
  getCommentDraftKey,
  groupCommentsByTarget,
  loadComments
} from './comments.js'
import {
  mountSongRecommendations,
  refreshSongRecommendations,
  showSongRecommendations,
  unmountSongRecommendations
} from './song-recommendations.js'
import {
  createIlikeFilterValue,
  renderPagination
} from './list-navigation.js'

const app = document.querySelector('#app')

let practiceChart = null
let realtimeChannel = null
let realtimeTimer = null
let realtimeSession = null
let realtimeFullRefresh = false
let realtimeDashboardRefresh = false
let realtimeSongRefresh = false
let selectedWeekStart = getCurrentWeekStart()
let activeView = 'practice'
const PRACTICE_LOGS_PER_PAGE = 10
let practiceListPage = 1
let practiceListSearch = ''
let practiceListRequestId = 0

function destroyChart() {
  if (practiceChart) {
    practiceChart.destroy()
    practiceChart = null
  }
}

function getCurrentWeekStart() {
  const now = new Date()
  const day = now.getDay()
  const difference = day === 0 ? 6 : day - 1

  const monday = new Date(now)
  monday.setDate(now.getDate() - difference)
  monday.setHours(0, 0, 0, 0)

  return monday
}

function moveWeek(weekStart, amount) {
  const movedWeek = new Date(weekStart)
  movedWeek.setDate(movedWeek.getDate() + amount * 7)

  return movedWeek
}

function isCurrentWeek(weekStart) {
  return (
    weekStart.getTime() ===
    getCurrentWeekStart().getTime()
  )
}

function formatWeekRange(weekStart) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  const formatDate = (date) =>
    `${date.getMonth() + 1}/${date.getDate()}`

  return `(${formatDate(weekStart)} 월요일 ~ ${formatDate(weekEnd)} 일요일)`
}

function formatLogDate(dateValue) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateValue))
}

function getGitHubUsername(session) {
  const metadata = session.user.user_metadata

  return (
    metadata.user_name ??
    metadata.preferred_username ??
    metadata.name ??
    session.user.email ??
    '사용자'
  )
}

function attachLogoutButton() {
  document
    .querySelector('#logoutButton')
    ?.addEventListener('click', signOut)
}

function renderSignedOut() {
  destroyChart()
  unmountSongRecommendations()
  practiceListRequestId += 1
  selectedWeekStart = getCurrentWeekStart()
  activeView = 'practice'
  practiceListPage = 1
  practiceListSearch = ''

  app.innerHTML = `
    <main class="login-container">
      <h1>🎸 밴드 연습 기록소</h1>
      <p>승인된 밴드원만 이용할 수 있습니다.</p>
      <button id="loginButton" class="login-button" type="button">
        GitHub로 로그인
      </button>
    </main>
  `

  document
    .querySelector('#loginButton')
    .addEventListener('click', signInWithGitHub)
}

function renderLoading() {
  destroyChart()
  unmountSongRecommendations()
  practiceListRequestId += 1

  app.innerHTML = `
    <main class="status-container">
      <h1>🎸 밴드 연습 기록소</h1>
      <p>연습 기록을 불러오고 있습니다.</p>
    </main>
  `
}

function renderPending() {
  destroyChart()
  unmountSongRecommendations()

  app.innerHTML = `
    <main class="status-container">
      <h1>🎸 밴드 연습 기록소</h1>
      <p>GitHub 로그인은 완료됐습니다.</p>
      <p>아직 밴드원 승인을 받지 않은 계정입니다.</p>
      <button id="logoutButton" type="button">
        로그아웃
      </button>
    </main>
  `

  attachLogoutButton()
}

function renderError(message) {
  destroyChart()
  unmountSongRecommendations()

  app.innerHTML = `
    <main class="status-container">
      <h1>🎸 밴드 연습 기록소</h1>
      <p>데이터를 불러오지 못했습니다.</p>
      <p id="errorMessage" class="error-message"></p>
      <button id="logoutButton" type="button">
        로그아웃
      </button>
    </main>
  `

  document.querySelector('#errorMessage').textContent = message
  attachLogoutButton()
}

function getWeeklyLogsQuery(weekStart) {
  const weekEnd = moveWeek(weekStart, 1)

  return supabase
    .from('practice_logs')
    .select(`
      id,
      member_id,
      category_id,
      minutes,
      comment,
      practiced_at,
      created_at,
      created_by
    `)
    .gte('practiced_at', weekStart.toISOString())
    .lt('practiced_at', weekEnd.toISOString())
    .order('practiced_at', { ascending: false })
}

function getPracticeSearchDateRange(searchValue) {
  const match = searchValue.match(
    /^(\d{4})\s*(?:[-./]|년\s*)(\d{1,2})\s*(?:[-./]|월\s*)(\d{1,2})\s*일?$/
  )

  if (!match) {
    return null
  }

  const [, yearValue, monthValue, dayValue] = match
  const year = Number(yearValue)
  const month = Number(monthValue)
  const day = Number(dayValue)
  const start = new Date(year, month - 1, day)

  if (
    start.getFullYear() !== year ||
    start.getMonth() !== month - 1 ||
    start.getDate() !== day
  ) {
    return null
  }

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return { start, end }
}

function getPracticeLogsPageQuery(members) {
  const firstRow =
    (practiceListPage - 1) * PRACTICE_LOGS_PER_PAGE
  const lastRow = firstRow + PRACTICE_LOGS_PER_PAGE - 1

  let query = supabase
    .from('practice_logs')
    .select(`
      id,
      member_id,
      category_id,
      minutes,
      comment,
      practiced_at,
      created_at,
      created_by
    `, { count: 'exact' })

  if (practiceListSearch) {
    const dateRange = getPracticeSearchDateRange(
      practiceListSearch
    )

    if (dateRange) {
      query = query
        .gte('practiced_at', dateRange.start.toISOString())
        .lt('practiced_at', dateRange.end.toISOString())
    } else {
      const ilikeValue = createIlikeFilterValue(
        practiceListSearch
      )
      const normalizedSearch =
        practiceListSearch.toLocaleLowerCase('ko-KR')
      const matchingMemberIds = members
        .filter((member) =>
          member.display_name
            .toLocaleLowerCase('ko-KR')
            .includes(normalizedSearch)
        )
        .map((member) => member.id)

      const filters = []

      if (ilikeValue) {
        filters.push(`comment.ilike.${ilikeValue}`)
      }

      if (matchingMemberIds.length > 0) {
        filters.push(
          `member_id.in.(${matchingMemberIds.join(',')})`
        )
      }

      if (filters.length > 0) {
        query = query.or(filters.join(','))
      }
    }
  }

  return query
    .order('practiced_at', { ascending: false })
    .range(firstRow, lastRow)
}

async function loadPracticeListData(members) {
  let logsResult = await getPracticeLogsPageQuery(members)

  if (logsResult.error) {
    throw logsResult.error
  }

  const totalCount = logsResult.count ?? 0
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / PRACTICE_LOGS_PER_PAGE)
  )

  if (practiceListPage > totalPages) {
    practiceListPage = totalPages
    logsResult = await getPracticeLogsPageQuery(members)

    if (logsResult.error) {
      throw logsResult.error
    }
  }

  const commentsResult = await loadComments(
    'practice',
    logsResult.data.map((log) => log.id)
  )

  if (commentsResult.error) {
    throw commentsResult.error
  }

  return {
    logs: logsResult.data,
    comments: commentsResult.data,
    totalCount
  }
}

async function loadDashboardData(session) {
  const weekStart = new Date(selectedWeekStart)

  const [membersResult, categoriesResult] = await Promise.all([
    supabase
      .from('band_members')
      .select(`
        id,
        user_id,
        display_name,
        part,
        role,
        is_approved,
        is_active,
        sort_order
      `)
      .order('sort_order'),

    supabase
      .from('practice_categories')
      .select(`
        id,
        name,
        color,
        is_active,
        sort_order
      `)
      .order('sort_order'),
  ])

  const error =
    membersResult.error ??
    categoriesResult.error

  if (error) {
    throw error
  }

  const members = membersResult.data
  const currentMember = members.find(
    (member) => member.user_id === session.user.id
  )

  if (!currentMember) {
    return {
      pending: true
    }
  }

  const [weeklyLogsResult, practiceListData] =
    await Promise.all([
      getWeeklyLogsQuery(weekStart),
      loadPracticeListData(members)
    ])

  if (weeklyLogsResult.error) {
    throw weeklyLogsResult.error
  }

  return {
    pending: false,
    currentMember,
    members,
    categories: categoriesResult.data,
    weeklyLogs: weeklyLogsResult.data,
    recentLogs: practiceListData.logs,
    practiceComments: practiceListData.comments,
    practiceTotalCount: practiceListData.totalCount,
    weekStart
  }
}

function queueRealtimeRefresh(table) {
  const isSongBoardTable = [
    'song_recommendations',
    'song_recommendation_votes',
    'song_recommendation_comments'
  ].includes(table)

  const isPartialDashboardTable = [
    'practice_logs',
    'practice_log_comments'
  ].includes(table)

  if (isSongBoardTable) {
    realtimeSongRefresh = true
  } else {
    realtimeDashboardRefresh = true

    if (!isPartialDashboardTable) {
      realtimeFullRefresh = true
    }
  }

  window.clearTimeout(realtimeTimer)
  realtimeTimer = window.setTimeout(() => {
    realtimeTimer = null
    void refreshFromRealtime()
  }, 300)
}

async function refreshFromRealtime() {
  const session = realtimeSession
  const needsFullRefresh = realtimeFullRefresh
  const needsDashboardRefresh = realtimeDashboardRefresh
  const needsSongRefresh = realtimeSongRefresh
  realtimeFullRefresh = false
  realtimeDashboardRefresh = false
  realtimeSongRefresh = false

  if (!session) {
    return
  }

  try {
    if (needsDashboardRefresh) {
      const data = await loadDashboardData(session)

      if (realtimeSession?.user.id !== session.user.id) {
        return
      }

      if (data.pending) {
        renderPending()
        return
      }

      const dashboardIsVisible =
        document.querySelector('#practiceChart') &&
        document.querySelector('#feedList')

      if (!dashboardIsVisible || needsFullRefresh) {
        renderDashboard(session, data)
      } else {
        renderChart(
          data.members,
          data.categories,
          data.weeklyLogs
        )

        renderFeed(
          data.recentLogs,
          data.members,
          data.categories,
          data.practiceComments,
          data.currentMember,
          session
        )
        renderPracticeListControls(
          data.practiceTotalCount,
          session,
          data.members,
          data.categories,
          data.currentMember
        )
      }
    }

    if (
      needsSongRefresh &&
      realtimeSession?.user.id === session.user.id
    ) {
      await refreshSongRecommendations()
    }
  } catch (error) {
    console.error('실시간 갱신 실패:', error)
  }
}

function startRealtime(session) {
  realtimeSession = session

  if (realtimeChannel) {
    return
  }

  realtimeChannel = supabase
    .channel('band-practice-board-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public'
      },
      (payload) => {
        const watchedTables = [
          'practice_logs',
          'band_members',
          'practice_categories',
          'song_recommendations',
          'song_recommendation_votes',
          'practice_log_comments',
          'song_recommendation_comments'
        ]

        if (watchedTables.includes(payload.table)) {
          queueRealtimeRefresh(payload.table)
        }
      }
    )
    .subscribe((status, error) => {
      if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'
      ) {
        console.error('실시간 연결 실패:', error)
      }
    })
}

async function stopRealtime() {
  realtimeSession = null
  realtimeFullRefresh = false
  realtimeDashboardRefresh = false
  realtimeSongRefresh = false
  window.clearTimeout(realtimeTimer)
  realtimeTimer = null
  unmountSongRecommendations()

  if (!realtimeChannel) {
    return
  }

  const channel = realtimeChannel
  realtimeChannel = null
  await supabase.removeChannel(channel)
}

function showDashboardView(view) {
  activeView = view

  const showingSongRecommendations =
    view === 'recommendations'

  const practiceView = document.querySelector(
    '#practiceView'
  )
  const recommendationsView = document.querySelector(
    '#songRecommendationsView'
  )
  const practiceTab = document.querySelector(
    '#practiceTabButton'
  )
  const recommendationsTab = document.querySelector(
    '#recommendationsTabButton'
  )

  if (
    !practiceView ||
    !recommendationsView ||
    !practiceTab ||
    !recommendationsTab
  ) {
    return
  }

  practiceView.hidden = showingSongRecommendations
  recommendationsView.hidden = !showingSongRecommendations

  practiceTab.classList.toggle(
    'is-active',
    !showingSongRecommendations
  )
  practiceTab.setAttribute(
    'aria-selected',
    String(!showingSongRecommendations)
  )

  recommendationsTab.classList.toggle(
    'is-active',
    showingSongRecommendations
  )
  recommendationsTab.setAttribute(
    'aria-selected',
    String(showingSongRecommendations)
  )

  if (showingSongRecommendations) {
    void showSongRecommendations()
    return
  }

  window.requestAnimationFrame(() => {
    practiceChart?.resize()
  })
}

function attachDashboardNavigation() {
  document
    .querySelector('#practiceTabButton')
    .addEventListener('click', () => {
      showDashboardView('practice')
    })

  document
    .querySelector('#recommendationsTabButton')
    .addEventListener('click', () => {
      showDashboardView('recommendations')
    })
}

function renderChart(members, categories, logs) {
  const activeMembers = members.filter(
    (member) => member.is_active
  )

  const activeCategories = categories.filter(
    (category) => category.is_active
  )

  const memberIndexes = new Map(
    activeMembers.map((member, index) => [member.id, index])
  )

  const datasets = activeCategories.map((category) => ({
    label: category.name,
    data: activeMembers.map(() => 0),
    backgroundColor: category.color
  }))

  const datasetByCategory = new Map(
    activeCategories.map((category, index) => [
      category.id,
      datasets[index]
    ])
  )

  logs.forEach((log) => {
    const memberIndex = memberIndexes.get(log.member_id)
    const dataset = datasetByCategory.get(log.category_id)

    if (memberIndex !== undefined && dataset) {
      dataset.data[memberIndex] += log.minutes
    }
  })

  const canvas = document.querySelector('#practiceChart')
  const context = canvas.getContext('2d')

  destroyChart()

  practiceChart = new Chart(context, {
    type: 'bar',
    data: {
      labels: activeMembers.map(
        (member) => member.display_name
      ),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        }
      },
      scales: {
        x: {
          stacked: true
        },
        y: {
          stacked: true,
          beginAtZero: true,
          suggestedMax: 600,
          ticks: {
            precision: 0
          },
          title: {
            display: true,
            text: '분'
          }
        }
      }
    }
  })
}

function updateWeekNavigation(weekStart) {
  const showingCurrentWeek = isCurrentWeek(weekStart)

  document.querySelector('#chartTitle').textContent =
    showingCurrentWeek
      ? '이번 주 연습량'
      : '주간 연습량'

  document.querySelector('#weekRange').textContent =
    formatWeekRange(weekStart)

  document.querySelector('#nextWeekButton').disabled =
    showingCurrentWeek

  document.querySelector('#currentWeekButton').hidden =
    showingCurrentWeek
}

function setWeekNavigationLoading(isLoading) {
  document.querySelector('#previousWeekButton').disabled =
    isLoading

  document.querySelector('#nextWeekButton').disabled =
    isLoading || isCurrentWeek(selectedWeekStart)

  document.querySelector('#currentWeekButton').disabled =
    isLoading
}

async function showWeek(
  weekStart,
  members,
  categories
) {
  const currentWeekStart = getCurrentWeekStart()

  if (weekStart.getTime() > currentWeekStart.getTime()) {
    return
  }

  setWeekNavigationLoading(true)

  const { data, error } = await getWeeklyLogsQuery(weekStart)

  if (error) {
    console.error(error)
    alert(`주간 기록 조회 실패: ${error.message}`)
    setWeekNavigationLoading(false)
    return
  }

  selectedWeekStart = new Date(weekStart)
  setWeekNavigationLoading(false)
  renderChart(members, categories, data)
  updateWeekNavigation(selectedWeekStart)
}

function attachWeekNavigation(members, categories) {
  document
    .querySelector('#previousWeekButton')
    .addEventListener('click', () => {
      void showWeek(
        moveWeek(selectedWeekStart, -1),
        members,
        categories
      )
    })

  document
    .querySelector('#nextWeekButton')
    .addEventListener('click', () => {
      void showWeek(
        moveWeek(selectedWeekStart, 1),
        members,
        categories
      )
    })

  document
    .querySelector('#currentWeekButton')
    .addEventListener('click', () => {
      void showWeek(
        getCurrentWeekStart(),
        members,
        categories
      )
    })
}

async function handleDeletePracticeLog(logId, session) {
  const confirmed = window.confirm(
    '이 연습 기록을 삭제할까요?'
  )

  if (!confirmed) {
    return
  }

  const { error } = await supabase
    .from('practice_logs')
    .delete()
    .eq('id', logId)

  if (error) {
    console.error(error)
    alert(`기록 삭제 실패: ${error.message}`)
    return
  }

  await render(session)
}

async function refreshPracticeList(
  session,
  members,
  categories,
  currentMember
) {
  const requestId = ++practiceListRequestId
  const summary = document.querySelector(
    '#practiceListSummary'
  )

  if (summary) {
    summary.textContent = '목록을 불러오고 있습니다.'
  }

  try {
    const practiceListData = await loadPracticeListData(members)

    if (
      requestId !== practiceListRequestId ||
      realtimeSession?.user.id !== session.user.id
    ) {
      return
    }

    renderFeed(
      practiceListData.logs,
      members,
      categories,
      practiceListData.comments,
      currentMember,
      session
    )
    renderPracticeListControls(
      practiceListData.totalCount,
      session,
      members,
      categories,
      currentMember
    )
  } catch (error) {
    console.error(error)

    if (requestId !== practiceListRequestId) {
      return
    }

    const feedList = document.querySelector('#feedList')

    if (feedList) {
      feedList.innerHTML = ''

      const errorMessage = document.createElement('p')
      errorMessage.className = 'empty-message error-message'
      errorMessage.textContent =
        '연습 기록을 불러오지 못했습니다.'
      feedList.append(errorMessage)
    }

    if (summary) {
      summary.textContent = ''
    }
  }
}

function renderPracticeListControls(
  totalCount,
  session,
  members,
  categories,
  currentMember
) {
  const searchInput = document.querySelector(
    '#practiceSearchInput'
  )
  const clearButton = document.querySelector(
    '#clearPracticeSearchButton'
  )
  const summary = document.querySelector(
    '#practiceListSummary'
  )
  const pagination = document.querySelector(
    '#practicePagination'
  )

  if (
    !searchInput ||
    !clearButton ||
    !summary ||
    !pagination
  ) {
    return
  }

  if (document.activeElement !== searchInput) {
    searchInput.value = practiceListSearch
  }

  clearButton.hidden = !practiceListSearch

  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / PRACTICE_LOGS_PER_PAGE)
  )
  const countLabel = practiceListSearch
    ? `검색 결과 ${totalCount}개`
    : `전체 ${totalCount}개`

  summary.textContent = totalCount > 0
    ? `${countLabel} · ${practiceListPage}/${totalPages} 페이지`
    : countLabel

  renderPagination({
    container: pagination,
    currentPage: practiceListPage,
    totalCount,
    pageSize: PRACTICE_LOGS_PER_PAGE,
    onPageChange: (page) => {
      if (page === practiceListPage) {
        return
      }

      practiceListPage = page
      void refreshPracticeList(
        session,
        members,
        categories,
        currentMember
      ).then(() => {
        document
          .querySelector('#practiceListSection')
          ?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          })
      })
    }
  })
}

function attachPracticeListControls(
  session,
  members,
  categories,
  currentMember
) {
  const form = document.querySelector('#practiceSearchForm')
  const searchInput = document.querySelector(
    '#practiceSearchInput'
  )
  const clearButton = document.querySelector(
    '#clearPracticeSearchButton'
  )

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    practiceListSearch = searchInput.value.trim()
    practiceListPage = 1
    void refreshPracticeList(
      session,
      members,
      categories,
      currentMember
    )
  })

  clearButton.addEventListener('click', () => {
    searchInput.value = ''
    practiceListSearch = ''
    practiceListPage = 1
    void refreshPracticeList(
      session,
      members,
      categories,
      currentMember
    )
  })
}

function renderFeed(
  logs,
  members,
  categories,
  comments,
  currentMember,
  session
) {
  const feedList = document.querySelector('#feedList')
  const commentDrafts = captureCommentDrafts(feedList)
  feedList.replaceChildren()

  if (logs.length === 0) {
    const emptyMessage = document.createElement('p')
    emptyMessage.className = 'empty-message'
    emptyMessage.textContent = practiceListSearch
      ? '검색 조건에 맞는 연습 기록이 없습니다.'
      : '아직 등록된 연습 기록이 없습니다.'

    feedList.append(emptyMessage)
    return
  }

  const membersById = new Map(
    members.map((member) => [member.id, member])
  )

  const categoriesById = new Map(
    categories.map((category) => [category.id, category])
  )

  const membersByUserId = new Map(
    members
      .filter((member) => member.user_id)
      .map((member) => [member.user_id, member])
  )

  const commentsByLogId = groupCommentsByTarget(
    comments,
    'practice_log_id'
  )

  const fragment = document.createDocumentFragment()

  logs.forEach((log) => {
    const member = membersById.get(log.member_id)
    const category = categoriesById.get(log.category_id)

    const card = document.createElement('article')
    card.className = 'log-card'
    card.style.borderLeftColor = category?.color ?? '#7f8c8d'

    const header = document.createElement('div')
    header.className = 'log-header'

    const badge = document.createElement('span')
    badge.className = 'category-badge'
    badge.style.backgroundColor =
      category?.color ?? '#7f8c8d'
    badge.textContent = category?.name ?? '기타'

    const details = document.createElement('span')
    details.textContent =
      `${member?.display_name ?? '알 수 없는 멤버'} | ` +
      `${formatLogDate(log.practiced_at)} | ` +
      `⏱️ ${log.minutes}분`

    const comment = document.createElement('div')
    comment.className = 'log-comment'
    comment.textContent = log.comment

      header.append(badge, details)

    const canDelete =
      currentMember.role === 'admin' ||
      log.created_by === session.user.id

    if (canDelete) {
      const deleteButton = document.createElement('button')
      deleteButton.className = 'delete-log-button'
      deleteButton.type = 'button'
      deleteButton.textContent = '삭제'
      deleteButton.addEventListener('click', () => {
        void handleDeletePracticeLog(log.id, session)
      })

      header.append(deleteButton)
    }

    const commentsSection = createCommentsSection({
      targetType: 'practice',
      targetId: log.id,
      comments: commentsByLogId.get(log.id) ?? [],
      membersByUserId,
      currentUserId: session.user.id,
      isAdmin: currentMember.role === 'admin',
      initialDraft:
        commentDrafts.get(
          getCommentDraftKey('practice', log.id)
        ) ?? ''
    })

    card.append(header, comment, commentsSection)
    fragment.append(card)
  })

  feedList.append(fragment)
}

function populatePracticeForm(
  currentMember,
  members,
  categories
) {
  const memberSelect =
    document.querySelector('#memberSelect')

  const categorySelect =
    document.querySelector('#categorySelect')

  const saveButton =
    document.querySelector('#saveLogButton')

  const selectableMembers =
    currentMember.role === 'admin'
      ? members.filter((member) => member.is_active)
      : [currentMember]

  const activeCategories = categories.filter(
    (category) => category.is_active
  )

  memberSelect.replaceChildren()
  categorySelect.replaceChildren()

  selectableMembers.forEach((member) => {
    const option = document.createElement('option')
    option.value = member.id
    option.textContent = member.display_name
    memberSelect.append(option)
  })

  activeCategories.forEach((category) => {
    const option = document.createElement('option')
    option.value = category.id
    option.textContent = category.name
    categorySelect.append(option)
  })

  saveButton.disabled =
    selectableMembers.length === 0 ||
    activeCategories.length === 0
}

function showFormMessage(message, isError = false) {
  const messageElement =
    document.querySelector('#formMessage')

  if (!messageElement) {
    return
  }

  messageElement.textContent = message
  messageElement.classList.toggle(
    'error-message',
    isError
  )
}

async function handlePracticeSubmit(event, session) {
  event.preventDefault()

  const form = event.currentTarget
  const saveButton =
    document.querySelector('#saveLogButton')

  const memberId =
    document.querySelector('#memberSelect').value

  const categoryId =
    document.querySelector('#categorySelect').value

  const minutes = Number(
    document.querySelector('#practiceMinutes').value
  )

  const comment =
    document.querySelector('#practiceComment')
      .value
      .trim()

  if (!memberId || !categoryId) {
    showFormMessage(
      '멤버와 카테고리를 선택해주세요.',
      true
    )
    return
  }

  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 1440
  ) {
    showFormMessage(
      '연습 시간은 1분에서 1440분 사이로 입력해주세요.',
      true
    )
    return
  }

  if (!comment) {
    showFormMessage(
      '연습 내용을 입력해주세요.',
      true
    )
    return
  }

  saveButton.disabled = true
  showFormMessage('저장하고 있습니다.')

  const { error } = await supabase
    .from('practice_logs')
    .insert({
      member_id: memberId,
      category_id: categoryId,
      minutes,
      comment,
      created_by: session.user.id
    })

  if (error) {
    console.error(error)
    showFormMessage(
      `기록 저장 실패: ${error.message}`,
      true
    )
    saveButton.disabled = false
    return
  }

  form.reset()

  await render(session)

  showFormMessage('연습 기록이 등록됐습니다.')
}

function renderDashboard(session, dashboardData) {
  const {
    currentMember,
    members,
    categories,
    weeklyLogs,
    recentLogs,
    practiceComments,
    practiceTotalCount,
    weekStart
  } = dashboardData

  app.innerHTML = `
    <main class="container">
      <header class="app-header">
        <div>
          <h1>🎸 밴드 연습 기록소</h1>
          <p class="account-info">
            <strong id="memberName"></strong>
            <span id="memberRole"></span>
          </p>
        </div>

        <button
          id="logoutButton"
          class="logout-button"
          type="button"
        >
          로그아웃
        </button>
      </header>

      <nav class="view-tabs" aria-label="주요 메뉴">
        <button
          id="practiceTabButton"
          class="view-tab-button is-active"
          type="button"
          aria-selected="true"
        >
          연습 기록
        </button>

        <button
          id="recommendationsTabButton"
          class="view-tab-button"
          type="button"
          aria-selected="false"
        >
          곡 추천
        </button>
      </nav>

      <div id="practiceView" class="view-panel">
        <section class="chart-section">
        <h2 id="chartTitle"></h2>

        <div class="week-navigation">
          <button
            id="previousWeekButton"
            class="week-navigation-button"
            type="button"
          >
            ← 지난주
          </button>

          <div class="week-navigation-center">
            <p
              id="weekRange"
              class="week-indicator"
              aria-live="polite"
            ></p>
            <button
              id="currentWeekButton"
              class="current-week-button"
              type="button"
              hidden
            >
              이번 주로
            </button>
          </div>

          <button
            id="nextWeekButton"
            class="week-navigation-button"
            type="button"
          >
            다음주 →
          </button>
        </div>

        <div class="chart-container">
          <canvas id="practiceChart"></canvas>
        </div>
        </section>

        <section class="form-section">
        <h2>새 연습 기록하기</h2>

        <form id="practiceForm">
          <div class="form-group">
            <label for="memberSelect">
              멤버 이름 (파트)
            </label>
            <select id="memberSelect" required></select>
          </div>

          <div class="form-group">
            <label for="categorySelect">
              연습 카테고리
            </label>
            <select id="categorySelect" required></select>
          </div>

          <div class="form-group">
            <label for="practiceMinutes">
              연습 시간 (분)
            </label>
            <input
              id="practiceMinutes"
              type="number"
              min="1"
              max="1440"
              step="1"
              placeholder="예: 90"
              required
            >
          </div>

          <div class="form-group">
            <label for="practiceComment">
              연습 내용 / 코멘트
            </label>
            <textarea
              id="practiceComment"
              rows="3"
              maxlength="1000"
              placeholder="어떤 연습을 했는지 남겨주세요."
              required
            ></textarea>
          </div>

          <button
            id="saveLogButton"
            class="save-button"
            type="submit"
          >
            기록 올리기
          </button>

          <p
            id="formMessage"
            class="form-message"
            aria-live="polite"
          ></p>
        </form>
        </section>

        <section id="practiceListSection" class="feed">
          <h2>최근 연습 기록</h2>

          <form
            id="practiceSearchForm"
            class="list-search-form"
            role="search"
          >
            <label class="visually-hidden" for="practiceSearchInput">
              연습 기록 검색
            </label>
            <input
              id="practiceSearchInput"
              class="list-search-input"
              type="search"
              maxlength="100"
              placeholder="멤버·연습 내용·날짜(2026-08-12)"
            >
            <button
              class="list-search-button"
              type="submit"
            >
              검색
            </button>
            <button
              id="clearPracticeSearchButton"
              class="list-clear-button"
              type="button"
              hidden
            >
              초기화
            </button>
          </form>

          <p
            id="practiceListSummary"
            class="list-result-summary"
            aria-live="polite"
          ></p>
          <div id="feedList"></div>
          <nav
            id="practicePagination"
            class="pagination"
            aria-label="연습 기록 페이지"
            hidden
          ></nav>
        </section>

        <section
          id="adminPanel"
          class="admin-section"
          hidden
        ></section>
      </div>

      <section
        id="songRecommendationsView"
        class="view-panel"
        hidden
      ></section>
    </main>
  `

  document.querySelector('#memberName').textContent =
    `${currentMember.display_name} · ${getGitHubUsername(session)}`

  document.querySelector('#memberRole').textContent =
    currentMember.role === 'admin'
      ? '관리자'
      : '밴드원'

  mountSongRecommendations({
    session,
    currentMember,
    members
  })
  attachDashboardNavigation()
  attachPracticeListControls(
    session,
    members,
    categories,
    currentMember
  )

  updateWeekNavigation(weekStart)
  attachWeekNavigation(members, categories)

      populatePracticeForm(
    currentMember,
    members,
    categories
  )

  document
    .querySelector('#practiceForm')
    .addEventListener('submit', (event) => {
      void handlePracticeSubmit(event, session)
    })

  renderAdminPanel({
    currentMember,
    members,
    categories,
    refresh: () => render(session)
  })

  attachLogoutButton()
  renderChart(members, categories, weeklyLogs)
  renderFeed(
    recentLogs,
    members,
    categories,
    practiceComments,
    currentMember,
    session
  )
  renderPracticeListControls(
    practiceTotalCount,
    session,
    members,
    categories,
    currentMember
  )
  showDashboardView(activeView)
}

async function render(session) {
  if (!session) {
    await stopRealtime()
    renderSignedOut()
    return
  }

  startRealtime(session)
  renderLoading()

  try {
    const dashboardData = await loadDashboardData(session)

    if (dashboardData.pending) {
      renderPending()
      return
    }

    renderDashboard(session, dashboardData)
  } catch (error) {
    console.error(error)
    renderError(error.message)
  }
}

async function signInWithGitHub() {
  const redirectTo = new URL(
    import.meta.env.BASE_URL,
    window.location.origin
  ).toString()

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo
    }
  })

  if (error) {
    console.error(error)
    alert(`GitHub 로그인 실패: ${error.message}`)
  }
}

async function signOut() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    console.error(error)
    alert(`로그아웃 실패: ${error.message}`)
  }
}

const {
  data: { session },
  error
} = await supabase.auth.getSession()

if (error) {
  console.error(error)
  renderError(error.message)
} else {
  await render(session)
}

supabase.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => {
    void render(session)
  }, 0)
})
