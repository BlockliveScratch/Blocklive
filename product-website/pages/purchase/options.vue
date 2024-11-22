<script setup lang=ts>
    defineProps<{name:string, perks:string[], price:number}>()
</script>
<template>
<form action="https://turbo-lamp-q499wwq5jwpfwrg-4242.app.github.dev/create-checkout-session" method="POST">
    <div class="option">
        <span class="optionName">{{ name }}</span>
        <div class="optionPerks">
            <span class="price">${{ price }}</span> per month
            <span class="optionPerk" v-for="perk in perks"> + {{ perk }} </span>
        </div>
    </div>
    </form>

</template>

<style src="./options.css"/>