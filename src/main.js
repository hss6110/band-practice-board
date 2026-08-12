import './style.css'
import Chart from 'chart.js/auto'
import { supabase } from './supabase.js'

const app = document.querySelector('#app')

let practiceChart = null

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

  app.innerHTML = `
    <main class="status-container">
      <h1>🎸 밴드 연습 기록소</h1>
      <p>연습 기록을 불러오고 있습니다.</p>
    </main>
  `
}

function renderPending() {
  destroyChart()

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

async function loadDashboardData(session) {
  const weekStart = getCurrentWeekStart()

  const [
    membersResult,
    categoriesResult,
    weeklyLogsResult,
    recentLogsResult
  ] = await Promise.all([
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

    supabase
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
      .order('practiced_at', { ascending: false }),

    supabase
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
      .order('practiced_at', { ascending: false })
      .limit(100)
  ])

  const error =
    membersResult.error ??
    categoriesResult.error ??
    weeklyLogsResult.error ??
    recentLogsResult.error

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

  return {
    pending: false,
    currentMember,
    members,
    categories: categoriesResult.data,
    weeklyLogs: weeklyLogsResult.data,
    recentLogs: recentLogsResult.data,
    weekStart
  }
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

function renderFeed(
  logs,
  members,
  categories,
  currentMember,
  session
) {
  const feedList = document.querySelector('#feedList')
  feedList.replaceChildren()

  if (logs.length === 0) {
    const emptyMessage = document.createElement('p')
    emptyMessage.className = 'empty-message'
    emptyMessage.textContent =
      '아직 등록된 연습 기록이 없습니다.'

    feedList.append(emptyMessage)
    return
  }

  const membersById = new Map(
    members.map((member) => [member.id, member])
  )

  const categoriesById = new Map(
    categories.map((category) => [category.id, category])
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

    card.append(header, comment)
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

      <section class="chart-section">
        <h2>이번 주 연습량</h2>
        <p id="weekRange" class="week-indicator"></p>

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
      <section class="feed">
        <h2>최근 연습 기록</h2>
        <div id="feedList"></div>
      </section>
    </main>
  `

  document.querySelector('#memberName').textContent =
    `${currentMember.display_name} · ${getGitHubUsername(session)}`

  document.querySelector('#memberRole').textContent =
    currentMember.role === 'admin'
      ? '관리자'
      : '밴드원'

  document.querySelector('#weekRange').textContent =
    formatWeekRange(weekStart)

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

  attachLogoutButton()
  renderChart(members, categories, weeklyLogs)
  renderFeed(
    recentLogs,
    members,
    categories,
    currentMember,
    session
  )
}

async function render(session) {
  if (!session) {
    renderSignedOut()
    return
  }

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