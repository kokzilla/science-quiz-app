<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Navbar from '~/components/Navbar.vue'
import { useTheme } from '~/composables/useTheme'

const route = useRoute()
const { initTheme } = useTheme()

const showNavbar = computed(() => {
  return route.path !== '/scoreboard'
})

onMounted(() => {
  initTheme()
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <Navbar v-if="showNavbar" />
    <main>
      <NuxtPage />
    </main>
  </div>
</template>
