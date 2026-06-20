<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Navbar from '~/components/Navbar.vue'

const route = useRoute()
const showNavbar = computed(() => {
  return route.path !== '/scoreboard'
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
